/**
 * Vietnamese keyword extraction for the chatbot knowledge base.
 *
 * The retrieval matcher (utils/chatbot/retrieval.ts) scores a query against each
 * entry's stored keyword terms. So the quality of casual-phrasing matching ("họ
 * nhắn như người thì phải lọc từ khoá") depends on emitting good keyword terms.
 *
 * Strategy: from the canonical question, take content words (drop generic
 * function words) plus adjacent bigrams. Unigrams come first so distinctive
 * single words always survive the cap; bigrams add phrase-level precision
 * (e.g. "cấp xã" vs "cấp tỉnh", "án tích", "vay vốn").
 *
 * Terms are stored WITH diacritics; retrieval compares diacritic-insensitively.
 */

// Generic Vietnamese function words — safe to drop across any topic. We do NOT
// drop domain nouns (they may be the distinctive term in another dataset).
const STOPWORDS = new Set(
  ('la va cua cac nhung nguoi duoc cho voi trong ve nhu the nao co the khi da se mot de khong ' +
    'nay do o ra thi ma hay hoac tai theo boi vi nen con den tu sau truoc tren duoi gi ai dau ' +
    'sao bao nhieu roi cung chi dang phai lam hon nua rat qua gom hien nay doi ' +
    // Extremely common syllables that carry no meaning on their own in this
    // domain. They still take part in bigrams ("công tác", "công dân"), so
    // phrase-level precision is kept while single-word noise matches are avoided.
    'cong tac viec dan cap quy dinh')
    .split(' ').filter(Boolean),
)

const MAX_TERMS = 40

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/gu, '').replace(/đ/gu, 'd').replace(/Đ/gu, 'D')
}

/** Extract keyword terms (unigrams + adjacent bigrams) from a Vietnamese question. */
export function extractKeywords(question: string): string[] {
  if (typeof question !== 'string' || !question.trim()) return []
  const normalized = question.normalize('NFKC').toLocaleLowerCase('vi-VN')
  const raw = normalized.split(/[^\p{L}\p{N}]+/u).filter(token => token.length >= 2)
  const isStop = (token: string) => STOPWORDS.has(stripDiacritics(token))

  // Unigrams drop generic words: on their own they cause false matches
  // ("công" would tie an entry to any question containing that syllable).
  const unigrams = [...new Set(raw.filter(token => !isStop(token)))]

  // Bigrams are built from the UNFILTERED token stream so meaningful compounds
  // survive even when one half is a generic word — "cấp xã" vs "cấp tỉnh" is
  // exactly the distinction that disambiguates two otherwise identical
  // questions. Pairs where both halves are generic are skipped as noise.
  const bigrams: string[] = []
  for (let i = 0; i < raw.length - 1; i++) {
    if (isStop(raw[i]) && isStop(raw[i + 1])) continue
    bigrams.push(`${raw[i]} ${raw[i + 1]}`)
  }

  // Unigrams first (never dropped by the cap), then distinct bigrams.
  return [...new Set([...unigrams, ...bigrams])].slice(0, MAX_TERMS)
}
