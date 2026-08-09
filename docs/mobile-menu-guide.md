# 📱 Hướng dẫn thêm menu item vào Mobile Drawer

## 🎯 Vị trí code
File: `app/layouts/default.vue` (dòng 158-332)

## 📋 Cấu trúc Mobile Drawer

### 1. Container chính (dòng 159-161)
```vue
<nav
  class="fixed top-0 w-[min(88vw,380px)] max-w-full h-[100dvh] flex flex-col bg-white shadow-[-12px_0_40px_rgba(15,35,18,0.24)] z-[10002] transition-[right] duration-[380ms] ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden lg:hidden"
  :class="isMobileMenuOpen ? 'right-0' : '-right-full'"
>
```

### 2. Header (dòng 165-176)
- Logo + Tên cổng
- Nút đóng (✕)

### 3. Language Switcher (dòng 179-190)
- Chuyển đổi VN/EN

### 4. Search Bar (dòng 193-199)
- Ô tìm kiếm với icon 🔍

### 5. Navigation Items (dòng 203-237)
**Đây là phần chính để thêm menu!**

Navigation items được render từ `navMenu` (dữ liệu từ cấu hình):

```vue
<ul class="list-none flex flex-col px-3.5 pt-3.5 pb-5 gap-1">
  <li v-for="item in navMenu" :key="item.id">
    <!-- Item có children: accordion -->
    <template v-if="item.children && item.children.length">
      <div @click.stop="toggleMobileSubmenu(item.id)">
        {{ navItemLabel(item) }}
        <i class="fa-solid fa-chevron-down"></i>
      </div>
      <ul v-if="mobileOpenSubmenu === item.id">
        <li v-for="child in item.children">
          {{ navItemLabel(child) }}
        </li>
      </ul>
    </template>
    
    <!-- Item không có children: link đơn -->
    <template v-else>
      <NuxtLink :to="item.url">
        {{ navItemLabel(item) }}
      </NuxtLink>
    </template>
  </li>
</ul>
```

### 6. Footer (dòng 240-330)
Chia làm 3 phần:

#### A. Khối danh tính người đọc (dòng 256-318)
- **Đã đăng nhập**: Avatar + Tên + Email + Nút "Trang cá nhân" + Nút "Đăng xuất" + Link thông báo
- **Chưa đăng nhập**: Nút "Đăng nhập để bình luận"

#### B. Hotline (dòng 320-326)
- Icon 📞 + Số hotline

#### C. CTA Button (dòng 327-329)
- Nút "Đăng ký tư vấn ngay"

---

## ✅ Cách thêm menu item mới

### Phương án 1: Thêm vào navigation data (Khuyến nghị)
Menu items được lấy từ `navMenu` - đây là dữ liệu được quản lý tập trung.

**Cách thêm:**
1. Vào `/admin/content/navigation/navbar`
2. Thêm item mới vào cấu hình navbar
3. Menu sẽ tự động xuất hiện ở cả desktop header và mobile drawer

### Phương án 2: Thêm item cố định vào drawer footer
Nếu muốn thêm một item **chỉ có trong mobile drawer** (như nút Đăng ký tư vấn):

**Vị trí:** Trong `<div class="px-4 py-4 bg-[#f8faf7]">` (dòng 240)

**Ví dụ thêm nút mới:**
```vue
<nuxt-link 
  to="/duong-dan-cua-ban" 
  class="flex items-center justify-center gap-2 bg-white border border-[rgba(30,70,32,0.12)] rounded-xl px-4 py-3 text-[0.88rem] font-bold text-[#385130] no-underline transition-colors active:bg-[#EEF2EC]"
  @click="isMobileMenuOpen = false"
>
  <i class="fa-solid fa-icon-cua-ban text-[#7CB342]" aria-hidden="true"></i>
  Tên menu của bạn
</nuxt-link>
```

---

## 🎨 Design Tokens đang dùng

### Colors
- Background: `bg-white`, `bg-[#f8faf7]`
- Border: `border-[rgba(30,70,32,0.12)]`
- Text: `text-[#385130]`, `text-[#1E251C]`
- Primary Green: `text-[#7CB342]`, `bg-[#4A6741]`
- Hover: `hover:bg-[rgba(30,70,32,0.08)]`

### Border Radius
- Card: `rounded-[14px]`, `rounded-xl`
- Small elements: `rounded-[10px]`

### Spacing
- Padding: `px-3.5 py-3`, `px-4 py-3`
- Gap: `gap-2`, `gap-3`

---

## ⚠️ Lưu ý quan trọng

### 1. Đóng menu sau khi click
Mọi link trong drawer footer phải có `@click="isMobileMenuOpen = false"` để đóng menu khi người dùng bấm:
```vue
<nuxt-link to="/profile" @click="isMobileMenuOpen = false">
```

### 2. Client-only cho nội dung động
Nếu menu item phụ thuộc vào user state (đã đăng nhập), phải bọc trong `<client-only>`:
```vue
<client-only>
  <div v-if="user">...</div>
</client-only>
```

### 3. Accessibility
- Thêm `aria-label` cho các icon button
- Thêm `aria-hidden="true"` cho decorative icons

### 4. Test trên nhiều device
- Width tối đa: `w-[min(88vw,380px)]`
- Height: `h-[100dvh]` (dynamic viewport height)
- Transition: `duration-[380ms] ease-[cubic-bezier(0.16,1,0.3,1)]`

---

## 🚀 Quick Actions

### Thêm divider giữa các section
```vue
<div class="h-px bg-[rgba(30,70,32,0.08)] my-2"></div>
```

### Thêm badge notification
```vue
<span class="min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-[#B04A4A] text-white text-[0.7rem] font-bold">
  {{ count }}
</span>
```

### Thêm icon
Dùng FontAwesome 6 Pro (đã self-hosted):
```vue
<i class="fa-solid fa-icon-name text-[#7CB342]" aria-hidden="true"></i>
```
