import assert from 'node:assert/strict'
import { describe, it, type TestContext } from 'node:test'

import { dbI18n, i18nOverride, type DbRows } from './_i18n-db.ts'
import { mountPublic, routes } from './_public-mount-harness.ts'
import { findAll, textOf, type MiniElement } from './_sfc-mount.ts'

/**
 * Trang Liên hệ (`contact_form` → `app/components/blocks/ContactFormBlock.vue`), hai lỗi người
 * dùng thấy trên bản build (2026-11-02, `127.0.0.1:3000/contact`):
 *
 *   1. Nhãn "Họ và tên người cần hỗ trợ * *". Hàng DB `form_name` (seed, mọi ngôn ngữ) đã có
 *      " *" ở cuối, component lại thêm dấu sao của nó (`<span aria-hidden> *</span>`) cho trường
 *      bắt buộc. Lượt SSR dùng từ điển hardcoded ("Họ và tên") nên chỉ thấy SAU hydrate.
 *   2. "Địa chỉ:Thôn Phượng Mỹ…", "Hotline:0903…" — `<template v-if> </template>` chỉ có một
 *      khoảng trắng: trình biên dịch Vue (whitespace 'condense') bỏ nó. Bản tiếng Anh còn tệ
 *      hơn: "Phone0903.480.985", "Emailcontact@…" — `labelMap` đổi "Hotline:"/"Email:" (viết
 *      giống nhau ở bản dịch en của chính khối) sang `t('phone')`/`t('email')` không có dấu
 *      hai chấm, đè lên bản dịch khối đã có.
 *
 * Khối dưới đây là đúng dữ liệu trang `contact` của CSDL người dùng (GET
 * /api/public/pages/contact): không có `fields` (dùng bốn trường mặc định), có bản dịch en.
 */

const CONTACT_BLOCK = {
  title: 'Gửi yêu cầu trợ giúp',
  showInfo: true,
  infoTitle: 'Thông tin Ban Biên tập',
  noteTitle: 'Cơ chế trợ giúp',
  noteText: 'Hệ thống trợ giúp tiếp nhận yêu cầu 24/7.',
  infoRows: [
    { label: 'Đơn vị chủ quản:', value: 'Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an' },
    { label: 'Địa chỉ:', value: 'Thôn Phượng Mỹ, xã Tam Hưng, thành phố Hà Nội' },
    { label: 'Hotline:', value: '0903.480.985' },
    { label: 'Email:', value: 'contact@conduonghuongthien.com.vn' },
  ],
  translations: {
    en: {
      title: 'Submit a help request',
      infoRows: [
        { label: 'Governing Body:', value: 'Department of Police (C11) - Ministry of Public Security' },
        { label: 'Address:', value: 'Phuong My Village, Tam Hung Commune, Hanoi City' },
        { label: 'Hotline:', value: '0903.480.985' },
        { label: 'Email:', value: 'contact@conduonghuongthien.com.vn' },
      ],
    },
  },
}

/** What `BlockNode.vue` `localizedNode` hands the leaf component: data + `translations[lang]` on top. */
function localized(data: Record<string, unknown>, lang: string) {
  if (lang === 'vi') return data
  const own = (data.translations as Record<string, Record<string, unknown>> | undefined)?.[lang] ?? {}
  return { ...data, ...own }
}

async function mountContact(t: TestContext, lang: string, data: Record<string, unknown> = CONTACT_BLOCK, options: { db?: 'seed' | 'none', rows?: DbRows } = { db: 'seed' }) {
  return mountPublic(t, {
    file: 'components/blocks/ContactFormBlock.vue',
    props: { block: { id: 9, data: localized(data, lang) } },
    responder: routes({}),
    globals: { document: { getElementById: () => null } },
    ...i18nOverride(dbI18n(lang, options)),
  })
}

const labels = (root: MiniElement) => findAll(root, el => el.tag === 'label').map(el => textOf(el))
/** The label's own words, without the component's required marker. */
const ownLabelText = (root: MiniElement) => findAll(root, el => el.tag === 'label')
  .map(el => el.children.filter(child => child.kind === 'text').map(child => (child as { text: string }).text).join('').trim())
const infoLines = (root: MiniElement) => findAll(root, el => el.tag === 'p' && findAll(el, s => s.tag === 'strong').length === 1).map(el => textOf(el))
const stars = (text: string) => (text.match(/\*/g) ?? []).length

describe('ContactFormBlock — one required marker, whatever the label text says', () => {
  for (const lang of ['vi', 'en', 'lo']) {
    it(`${lang}, DB translations loaded (seed rows carry " *"): every required label shows ONE star, the component's`, async (t) => {
      const ctx = await mountContact(t, lang)
      const shown = labels(ctx.page.root)
      assert.equal(shown.length, 4, shown.join(' | '))
      for (const text of shown) assert.equal(stars(text), 1, `"${text}"`)
      for (const text of ownLabelText(ctx.page.root)) assert.doesNotMatch(text, /\*/, `label text keeps its own star: "${text}"`)
      // The marker left is the aria-hidden one: screen readers hear `aria-required`, not "sao".
      const markers = findAll(ctx.page.root, el => el.tag === 'span' && el.props['aria-hidden'] === 'true' && textOf(el) === '*')
      assert.equal(markers.length, 4)
    })
  }

  it('vi, the exact words the user saw: "Họ và tên người cần hỗ trợ *", not "… * *"', async (t) => {
    const ctx = await mountContact(t, 'vi')
    assert.deepEqual(labels(ctx.page.root), [
      'Họ và tên người cần hỗ trợ *',
      'Số điện thoại liên hệ *',
      'Tỉnh / Thành phố *',
      'Nội dung cần hỗ trợ *',
    ])
  })

  it('a label an officer typed with its own star ("Họ và tên *", required) shows one; an optional one shows none', async (t) => {
    const ctx = await mountContact(t, 'vi', {
      ...CONTACT_BLOCK,
      fields: [
        { id: 'a', label: 'Họ và tên *', type: 'text', required: true, map: 'name' },
        { id: 'b', label: 'Ghi chú', type: 'textarea', required: false },
        { id: 'c', label: 'Số điện thoại**', type: 'tel', required: true, map: 'phone' },
        { id: 'd', label: 'Ghi chú thêm *', type: 'textarea', required: false },
      ],
    })
    assert.deepEqual(labels(ctx.page.root), ['Họ và tên *', 'Ghi chú', 'Số điện thoại *', 'Ghi chú thêm'])
    // The one star left on a required field is the component's, next to `aria-required`.
    const controls = findAll(ctx.page.root, el => el.tag === 'input' || el.tag === 'textarea')
    assert.deepEqual(controls.map(el => el.props['aria-required'] ?? null), ['true', null, 'true', null])
  })

  // Kiểm chứng độc lập W4: an OPTIONAL field labelled like a default one ("Tỉnh / Thành phố") is
  // translated through FIELD_LABEL_MAP into the seeded row "Province / City *" — a star with no
  // `aria-required` behind it. The star is the template's alone; the label never brings one.
  for (const lang of ['en', 'lo', 'vi']) {
    it(`${lang}: an optional field mapped to a seeded key shows no star; a required one shows the template's`, async (t) => {
      const ctx = await mountContact(t, lang, {
        ...CONTACT_BLOCK,
        fields: [
          { id: 'city', label: 'Tỉnh / Thành phố', type: 'text', required: false, map: 'address' },
          { id: 'name', label: 'Họ và tên', type: 'text', required: true, map: 'name' },
        ],
      })
      const [city, name] = labels(ctx.page.root)
      assert.equal(stars(city!), 0, `optional "${city}"`)
      assert.equal(stars(name!), 1, `required "${name}"`)
      const controls = findAll(ctx.page.root, el => el.tag === 'input')
      assert.deepEqual(controls.map(el => el.props['aria-required'] ?? null), [null, 'true'])
      if (lang === 'en') assert.deepEqual([city, name], ['Province / City', 'Full Name of Applicant *'])
    })
  }

  it('en: a label an officer typed with its own star is still found in the translation table ("Họ và tên *" → "Full Name of Applicant")', async (t) => {
    const ctx = await mountContact(t, 'en', {
      ...CONTACT_BLOCK,
      fields: [
        { id: 'a', label: 'Họ và tên *', type: 'text', required: true, map: 'name' },
        { id: 'b', label: ' Tỉnh / Thành phố * ', type: 'text', required: false, map: 'address' },
      ],
    })
    assert.deepEqual(labels(ctx.page.root), ['Full Name of Applicant *', 'Province / City'])
  })

  it('before the DB answers (hardcoded dictionary) the labels already read with one star', async (t) => {
    const ctx = await mountContact(t, 'vi', CONTACT_BLOCK, { db: 'none' })
    assert.deepEqual(labels(ctx.page.root), ['Họ và tên *', 'Số điện thoại *', 'Tỉnh / Thành phố *', 'Nội dung cần hỗ trợ *'])
  })
})

describe('ContactFormBlock — "Nhãn: giá trị" with the space and the colon', () => {
  it('vi: "Địa chỉ: Thôn…", "Hotline: 0903…" (not "Địa chỉ:Thôn…")', async (t) => {
    const ctx = await mountContact(t, 'vi')
    assert.deepEqual(infoLines(ctx.page.root), [
      'Đơn vị chủ quản: Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an',
      'Địa chỉ: Thôn Phượng Mỹ, xã Tam Hưng, thành phố Hà Nội',
      'Hotline: 0903.480.985',
      'Email: contact@conduonghuongthien.com.vn',
    ])
  })

  it('en: the block\'s own English rows win, with the space ("Hotline: 0903…", not "Phone0903…")', async (t) => {
    const ctx = await mountContact(t, 'en')
    assert.deepEqual(infoLines(ctx.page.root), [
      'Governing Body: Department of Police (C11) - Ministry of Public Security',
      'Address: Phuong My Village, Tam Hung Commune, Hanoi City',
      'Hotline: 0903.480.985',
      'Email: contact@conduonghuongthien.com.vn',
    ])
  })

  it('a language the block has no translation for: the generic labels keep their colon and the space', async (t) => {
    const ctx = await mountContact(t, 'en', { ...CONTACT_BLOCK, translations: {} })
    const lines = infoLines(ctx.page.root)
    assert.equal(lines.length, 4)
    for (const line of lines) assert.match(line, /^[^:]+: \S/, `"${line}"`)
    assert.ok(lines[1]!.startsWith('Address: Thôn Phượng Mỹ'), lines[1])
    assert.ok(lines[2]!.startsWith('Phone: 0903'), lines[2])
  })

  it('a row with no label shows only its value, with no stray space', async (t) => {
    const ctx = await mountContact(t, 'vi', { ...CONTACT_BLOCK, infoRows: [{ label: '', value: 'Chỉ có giá trị' }] })
    const row = findAll(ctx.page.root, el => el.tag === 'p' && textOf(el).includes('Chỉ có giá trị'))
    assert.equal(row.length, 1)
    const own = row[0]!.children.filter(child => child.kind === 'text').map(child => (child as { text: string }).text).join('')
    assert.equal(own, 'Chỉ có giá trị')
  })
})
