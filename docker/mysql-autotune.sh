#!/bin/sh
# ─── Auto-tune MySQL config based on VPS specs ──────────────────────────────
# Generates /etc/mysql/conf.d/auto-tune.cnf at container startup
# Run before mysqld starts

# Resolve the memory this CONTAINER may use, not the host's total RAM.
# /proc/meminfo always reports the host, so with a compose `mem_limit` the old
# logic sized the buffer pool from host RAM and the container got OOM-killed.
# cgroup v2 exposes memory.max, cgroup v1 memory.limit_in_bytes; both report a
# very large sentinel value ("max" / ~9.2e18) when no limit is set.
read_cgroup_mem_mb() {
  _limit=""
  if [ -r /sys/fs/cgroup/memory.max ]; then
    _limit=$(cat /sys/fs/cgroup/memory.max 2>/dev/null)
  elif [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
    _limit=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null)
  fi
  case "$_limit" in
    ''|max|*[!0-9]*) echo "" ; return ;;
  esac
  # Treat anything above 1 TiB as "no limit set".
  if [ "$_limit" -gt 1099511627776 ] 2>/dev/null; then echo ""; return; fi
  echo $((_limit / 1024 / 1024))
}

# Effective CPU quota (cgroup v2 "quota period", v1 cfs_quota/cfs_period).
read_cgroup_cpus() {
  if [ -r /sys/fs/cgroup/cpu.max ]; then
    set -- $(cat /sys/fs/cgroup/cpu.max 2>/dev/null)
    [ "$1" = "max" ] && { echo ""; return; }
    [ -n "$1" ] && [ -n "$2" ] && [ "$2" -gt 0 ] 2>/dev/null && echo $(( ($1 + $2 - 1) / $2 )) && return
  elif [ -r /sys/fs/cgroup/cpu/cpu.cfs_quota_us ]; then
    _q=$(cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us 2>/dev/null)
    _p=$(cat /sys/fs/cgroup/cpu/cpu.cfs_period_us 2>/dev/null)
    [ "$_q" -gt 0 ] 2>/dev/null && [ "$_p" -gt 0 ] 2>/dev/null && echo $(( (_q + _p - 1) / _p )) && return
  fi
  echo ""
}

HOST_RAM_MB=$(($(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024))
CGROUP_RAM_MB=$(read_cgroup_mem_mb)
if [ -n "$CGROUP_RAM_MB" ] && [ "$CGROUP_RAM_MB" -gt 0 ] 2>/dev/null; then
  TOTAL_RAM_MB=$CGROUP_RAM_MB
  RAM_SOURCE="giới hạn container"
else
  TOTAL_RAM_MB=$HOST_RAM_MB
  RAM_SOURCE="RAM máy chủ"
fi

CGROUP_CPUS=$(read_cgroup_cpus)
if [ -n "$CGROUP_CPUS" ] && [ "$CGROUP_CPUS" -gt 0 ] 2>/dev/null; then
  CPU_CORES=$CGROUP_CPUS
else
  CPU_CORES=$(nproc)
fi
[ "$CPU_CORES" -lt 1 ] 2>/dev/null && CPU_CORES=1

# Buffer pool: ~25% of total RAM (safe for shared VPS with app container)
BUFFER_POOL_MB=$((TOTAL_RAM_MB / 4))
# Minimum 128MB, maximum 8GB
[ $BUFFER_POOL_MB -lt 128 ] && BUFFER_POOL_MB=128
[ $BUFFER_POOL_MB -gt 8192 ] && BUFFER_POOL_MB=8192

# Buffer pool instances: 1 per GB of buffer pool (min 1, max 8)
POOL_INSTANCES=$((BUFFER_POOL_MB / 1024))
[ $POOL_INSTANCES -lt 1 ] && POOL_INSTANCES=1
[ $POOL_INSTANCES -gt 8 ] && POOL_INSTANCES=8

# Log file size: ~25% of buffer pool
LOG_FILE_MB=$((BUFFER_POOL_MB / 4))
[ $LOG_FILE_MB -lt 48 ] && LOG_FILE_MB=48
[ $LOG_FILE_MB -gt 512 ] && LOG_FILE_MB=512

# Log buffer: scale with RAM
LOG_BUFFER_MB=$((TOTAL_RAM_MB / 256))
[ $LOG_BUFFER_MB -lt 16 ] && LOG_BUFFER_MB=16
[ $LOG_BUFFER_MB -gt 128 ] && LOG_BUFFER_MB=128

# Connections: scale with RAM (1 connection ~ 1MB overhead)
MAX_CONN=$((TOTAL_RAM_MB / 32))
[ $MAX_CONN -lt 30 ] && MAX_CONN=30
[ $MAX_CONN -gt 500 ] && MAX_CONN=500

# Thread cache
THREAD_CACHE=$((MAX_CONN / 8))
[ $THREAD_CACHE -lt 4 ] && THREAD_CACHE=4
[ $THREAD_CACHE -gt 64 ] && THREAD_CACHE=64

# Table open cache
TABLE_CACHE=$((TOTAL_RAM_MB * 2))
[ $TABLE_CACHE -lt 400 ] && TABLE_CACHE=400
[ $TABLE_CACHE -gt 8192 ] && TABLE_CACHE=8192

# IO threads: based on CPU cores
IO_THREADS=$((CPU_CORES))
[ $IO_THREADS -lt 2 ] && IO_THREADS=2
[ $IO_THREADS -gt 16 ] && IO_THREADS=16

# IO capacity: SSD assumed
IO_CAPACITY=$((CPU_CORES * 500))
[ $IO_CAPACITY -lt 1000 ] && IO_CAPACITY=1000
[ $IO_CAPACITY -gt 10000 ] && IO_CAPACITY=10000
IO_CAPACITY_MAX=$((IO_CAPACITY * 2))

# Temp tables
TMP_TABLE_MB=$((TOTAL_RAM_MB / 128))
[ $TMP_TABLE_MB -lt 16 ] && TMP_TABLE_MB=16
[ $TMP_TABLE_MB -gt 256 ] && TMP_TABLE_MB=256

# Sort/Join buffer
SORT_BUFFER_MB=$((TOTAL_RAM_MB / 2048))
[ $SORT_BUFFER_MB -lt 2 ] && SORT_BUFFER_MB=2
[ $SORT_BUFFER_MB -gt 16 ] && SORT_BUFFER_MB=16

# Durability: default keeps the existing (fast) behaviour.
if [ "${MYSQL_DURABILITY}" = "strict" ]; then FLUSH_AT_COMMIT=1; else FLUSH_AT_COMMIT=2; fi

echo "── MySQL Auto-Tune ──────────────────────────────"
echo "   RAM: ${TOTAL_RAM_MB}MB (${RAM_SOURCE}) | CPU: ${CPU_CORES} cores"
echo "   Buffer Pool: ${BUFFER_POOL_MB}MB (${POOL_INSTANCES} instances)"
echo "   Max Connections: ${MAX_CONN}"
echo "   IO Threads: ${IO_THREADS} | IO Capacity: ${IO_CAPACITY}"
echo "   Durability: innodb_flush_log_at_trx_commit=${FLUSH_AT_COMMIT}"
echo "──────────────────────────────────────────────────"

cat > /etc/mysql/conf.d/auto-tune.cnf << CNFEOF
[mysqld]
# ─── Auto-generated: ${TOTAL_RAM_MB}MB RAM, ${CPU_CORES} CPUs ────
innodb_buffer_pool_size = ${BUFFER_POOL_MB}M
innodb_buffer_pool_instances = ${POOL_INSTANCES}
innodb_log_file_size = ${LOG_FILE_MB}M
innodb_log_buffer_size = ${LOG_BUFFER_MB}M

max_connections = ${MAX_CONN}
thread_cache_size = ${THREAD_CACHE}
table_open_cache = ${TABLE_CACHE}

# 2 = flush to OS cache each commit, fsync once per second. Faster, but up to
# ~1s of committed transactions can be lost if the HOST crashes (a container or
# mysqld crash alone loses nothing). Set MYSQL_DURABILITY=strict in .env for
# full ACID (=1) on machines where that matters.
innodb_flush_log_at_trx_commit = ${FLUSH_AT_COMMIT}
innodb_flush_method = O_DIRECT
innodb_io_capacity = ${IO_CAPACITY}
innodb_io_capacity_max = ${IO_CAPACITY_MAX}
innodb_read_io_threads = ${IO_THREADS}
innodb_write_io_threads = ${IO_THREADS}
skip_name_resolve = 1

tmp_table_size = ${TMP_TABLE_MB}M
max_heap_table_size = ${TMP_TABLE_MB}M
sort_buffer_size = ${SORT_BUFFER_MB}M
join_buffer_size = ${SORT_BUFFER_MB}M

character_set_server = utf8mb4
collation_server = utf8mb4_unicode_ci
CNFEOF
