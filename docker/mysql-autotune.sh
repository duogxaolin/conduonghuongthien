#!/bin/sh
# ─── Auto-tune MySQL config based on VPS specs ──────────────────────────────
# Generates /etc/mysql/conf.d/auto-tune.cnf at container startup
# Run before mysqld starts

TOTAL_RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
TOTAL_RAM_MB=$((TOTAL_RAM_KB / 1024))
CPU_CORES=$(nproc)

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

echo "── MySQL Auto-Tune ──────────────────────────────"
echo "   RAM: ${TOTAL_RAM_MB}MB | CPU: ${CPU_CORES} cores"
echo "   Buffer Pool: ${BUFFER_POOL_MB}MB (${POOL_INSTANCES} instances)"
echo "   Max Connections: ${MAX_CONN}"
echo "   IO Threads: ${IO_THREADS} | IO Capacity: ${IO_CAPACITY}"
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

innodb_flush_log_at_trx_commit = 2
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
