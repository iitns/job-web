const MOBILE_VIEWPORT_QUERY = window.matchMedia('(max-width: 980px)')
const ACTIVE_TAB_STORAGE_KEY = 'job-web:active-tab'

const TAB_LABELS = {
  search: '목록',
  recommend: '추천',
  favorites: '즐겨찾기',
  manage: '이력서 관리',
}

const LOCATION_ABBREVIATIONS = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
  'district of columbia': 'DC',
  'united states': 'US',
  usa: 'US',
  korea: 'KR',
  'south korea': 'KR',
  'republic of korea': 'KR',
  japan: 'JP',
  singapore: 'SG',
  taiwan: 'TW',
  germany: 'DE',
  canada: 'CA',
  australia: 'AU',
  india: 'IN',
  ireland: 'IE',
  'united kingdom': 'UK',
  uk: 'UK',
  france: 'FR',
  spain: 'ES',
  netherlands: 'NL',
  poland: 'PL',
}

function availableTabs(isMobile = MOBILE_VIEWPORT_QUERY.matches) {
  return ['recommend', 'search', 'favorites', 'manage']
}

function normalizeTab(tab, isMobile = MOBILE_VIEWPORT_QUERY.matches) {
  if (tab === 'update' || tab === 'extract') {
    return 'manage'
  }
  return availableTabs(isMobile).includes(tab) ? tab : 'recommend'
}

function readStoredActiveTab() {
  try {
    return window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY) || 'recommend'
  } catch {
    return 'recommend'
  }
}

function persistActiveTab(tab) {
  try {
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tab)
  } catch {}
}

const state = {
  activeTab: normalizeTab(readStoredActiveTab()),
  draftKeyword: '',
  searchKeyword: '',
  selectedCompanies: [],
  selectedSkills: [],
  skillListExpanded: false,
  companies: [],
  skills: [],
  jobs: [],
  total: 0,
  page: 1,
  pageSize: 12,
  selectedJobId: null,
  selectedJob: null,
  loading: false,
  detailLoading: false,
  error: '',
  favoriteError: '',
  searchReady: true,
  source: 'postgres',
  resume: null,
  resumeProfile: null,
  recommendationReady: false,
  recommendationMessage: '',
  resumeLoading: false,
  resumeUploading: false,
  resumeError: '',
  resumeSuccess: '',
  resumeList: [],
  resumeListLoading: false,
  resumeListError: '',
  selectedResumeRecordId: null,
  selectedResumeRecord: null,
  selectedResumeRecordProfile: null,
  selectedResumeRecordLoading: false,
  selectedResumeRecordError: '',
  resumeActionId: null,
  favoriteActionJobIds: [],
  isMobile: MOBILE_VIEWPORT_QUERY.matches,
  mobileMenuOpen: false,
}

persistActiveTab(state.activeTab)

const root = document.querySelector('#root')

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatDate(value) {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) {
    return '미정'
  }
  return date.toLocaleDateString('ko-KR')
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) {
    return '미정'
  }
  return date.toLocaleString('ko-KR')
}

function formatCardDate(value) {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) {
    return '미정'
  }

  const year = String(date.getFullYear()).slice(-2)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const currentYear = new Date().getFullYear()

  return date.getFullYear() === currentYear ? `${month}.${day}` : `${year}.${month}.${day}`
}

function normalizeLocationKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replaceAll('.', '')
}

function compactLocation(value) {
  const input = String(value || '').trim()
  if (!input) {
    return '미정'
  }

  const normalizedInput = normalizeLocationKey(input)
  if (normalizedInput.includes('remote')) {
    return 'Remote'
  }
  if (normalizedInput.includes('hybrid')) {
    return 'Hybrid'
  }

  const tokens = input
    .split(/[\\/|]/)
    .flatMap((part) => part.split(','))
    .map((part) => part.trim())
    .filter(Boolean)

  const prioritizedTokens = tokens.length > 1 ? [...tokens.slice(0, -1)].reverse().concat(tokens[tokens.length - 1]) : tokens

  for (const token of prioritizedTokens) {
    const key = normalizeLocationKey(token)
    if (LOCATION_ABBREVIATIONS[key]) {
      return LOCATION_ABBREVIATIONS[key]
    }

    if (/^[A-Z]{2,4}$/.test(token)) {
      return token
    }
  }

  const fallback = tokens[tokens.length - 1] || input
  const words = fallback.split(/\s+/).filter(Boolean)
  if (words.length > 1 && words.length <= 3) {
    const initials = words.map((word) => word[0]).join('').toUpperCase()
    if (initials.length <= 4) {
      return initials
    }
  }

  return fallback.length > 12 ? `${fallback.slice(0, 11)}…` : fallback
}

function extractLocationLabel(value) {
  const input = String(value || '').trim()
  if (!input) {
    return ''
  }

  const normalizedInput = normalizeLocationKey(input)
  if (normalizedInput.includes('remote')) {
    return 'Remote'
  }
  if (normalizedInput.includes('hybrid')) {
    return 'Hybrid'
  }

  const [city] = input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  return city || compactLocation(input)
}

function uniqueLocationValues(locations) {
  const values = []

  normalizeList(locations).forEach((item) => {
    const value = String(item || '').trim()
    if (value && !values.includes(value)) {
      values.push(value)
    }
  })

  return values
}

function summarizeLocationList(locations) {
  const labels = []

  uniqueLocationValues(locations).forEach((item) => {
    const label = extractLocationLabel(item)
    if (label && !labels.includes(label)) {
      labels.push(label)
    }
  })

  if (!labels.length) {
    return '미정'
  }

  return labels.length === 1 ? labels[0] : `${labels[0]} 외 ${labels.length - 1}곳`
}

function formatLocationList(locations) {
  const values = uniqueLocationValues(locations)
  return values.length ? values.join(' / ') : '미정'
}

function renderMobileMetaLine(job) {
  const parts = [
    `<span class="job-company">${escapeHtml(job.company)}</span>`,
  ]

  if (job.level_guess) {
    parts.push(`<span class="job-level">${escapeHtml(job.level_guess)}</span>`)
  }

  parts.push(`<span class="job-location">${escapeHtml(summarizeLocationList(job.locations))}</span>`)
  parts.push(`<span class="job-date">${escapeHtml(formatCardDate(job.posted_at))}</span>`)

  return parts
    .map((part, index) => (index === 0 ? part : `<span class="job-meta-divider">·</span>${part}`))
    .join('')
}

function isFavoriteActionPending(jobId) {
  return state.favoriteActionJobIds.includes(jobId)
}

function favoriteAriaLabel(job) {
  return job.is_favorited ? '즐겨찾기 해제' : '즐겨찾기 추가'
}

function renderFavoriteButton(job, { context = 'card' } = {}) {
  const pending = isFavoriteActionPending(job.job_id)
  const className = [
    'favorite-button',
    context === 'detail' ? 'detail-favorite-button' : 'card-favorite-button',
    job.is_favorited ? 'active' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return `
    <button
      class="${className}"
      type="button"
      data-favorite-job-id="${escapeHtml(job.job_id)}"
      data-next-favorite="${job.is_favorited ? 'false' : 'true'}"
      aria-label="${favoriteAriaLabel(job)}"
      aria-pressed="${job.is_favorited ? 'true' : 'false'}"
      ${pending ? 'disabled' : ''}
    >
      <svg class="favorite-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.75 14.62 9.06 20.48 9.91 16.24 14.05 17.24 19.89 12 17.13 6.76 19.89 7.76 14.05 3.52 9.91 9.38 9.06 12 3.75Z"></path>
      </svg>
      ${
        context === 'detail'
          ? `<span>${job.is_favorited ? '즐겨찾기됨' : '즐겨찾기'}</span>`
          : ''
      }
    </button>
  `
}

function renderJobCardHeader(job) {
  if (state.isMobile) {
    return `
      <div class="job-card-topline mobile">
        <div class="job-card-titleblock">
          <div class="job-card-meta-row">
            ${renderMobileMetaLine(job)}
          </div>
          <div class="job-card-titleline">
            <span class="job-title">${escapeHtml(job.title)}</span>
          </div>
        </div>
        <div class="job-card-sidegroup mobile">
          ${
            job.recommendation_score
              ? `<span class="recommendation-badge">${escapeHtml(job.recommendation_score)}</span>`
              : ''
          }
          ${renderFavoriteButton(job)}
        </div>
      </div>
    `
  }

  return `
    <div class="job-card-topline">
      <div class="job-card-titleblock">
        <div class="job-card-titleline">
          <span class="job-company">${escapeHtml(job.company)}</span>
          <span class="job-meta-divider">·</span>
          <span class="job-title">${escapeHtml(job.title)}</span>
        </div>
      </div>
      <div class="job-card-sidegroup">
        <div class="job-card-side-meta">
          <span>${escapeHtml(summarizeLocationList(job.locations))}</span>
          <span class="job-meta-divider">·</span>
          <span>${escapeHtml(formatCardDate(job.posted_at))}</span>
        </div>
        ${
          job.recommendation_score
            ? `<span class="recommendation-badge">${escapeHtml(job.recommendation_score)}</span>`
            : ''
        }
        ${renderFavoriteButton(job)}
      </div>
    </div>
  `
}

function splitTextLines(value) {
  return String(value || '')
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

function uniqueTextList(items) {
  const values = []

  items.forEach((item) => {
    const value = String(item || '').trim()
    if (value && !values.includes(value)) {
      values.push(value)
    }
  })

  return values
}

function sortOptionsWithSelected(options, selected) {
  const selectedSet = new Set(selected)

  return [...uniqueTextList(options)].sort((left, right) => {
    const leftSelected = selectedSet.has(left)
    const rightSelected = selectedSet.has(right)

    if (leftSelected !== rightSelected) {
      return leftSelected ? -1 : 1
    }

    return left.localeCompare(right, 'en', { sensitivity: 'base' })
  })
}

function resumeSuggestedSkills() {
  return uniqueTextList(normalizeList(state.resumeProfile?.skills))
}

function sortSkillOptions(options) {
  const selectedSet = new Set(state.selectedSkills)
  const resumeSkillSet = new Set(state.activeTab === 'recommend' ? resumeSuggestedSkills() : [])

  return [...uniqueTextList(options)].sort((left, right) => {
    const leftSelected = selectedSet.has(left)
    const rightSelected = selectedSet.has(right)
    const leftResumeSkill = resumeSkillSet.has(left)
    const rightResumeSkill = resumeSkillSet.has(right)

    if (state.activeTab === 'recommend') {
      const leftPriority = leftResumeSkill ? (leftSelected ? 0 : 1) : leftSelected ? 2 : 3
      const rightPriority = rightResumeSkill ? (rightSelected ? 0 : 1) : rightSelected ? 2 : 3

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority
      }
    } else if (leftSelected !== rightSelected) {
      return leftSelected ? -1 : 1
    }

    if (state.activeTab !== 'recommend' && leftResumeSkill !== rightResumeSkill) {
      return leftResumeSkill ? -1 : 1
    }

    return left.localeCompare(right, 'en', { sensitivity: 'base' })
  })
}

function formatYears(value) {
  if (value === null || value === undefined || value === '') {
    return '미정'
  }
  return `${value}년`
}

function resumeFilename(resume) {
  return resume?.original_filename || resume?.filename || resume?.label || '최근 이력서'
}

function resumeStatusLabel(resume) {
  return resume?.status_label || '상태 확인 중'
}

function recommendationStatusLabel(resume) {
  return resume?.recommendation_ready ? '추천 준비 완료' : '추천 준비 중'
}

function resumeActiveLabel(resume) {
  return resume?.is_active ? '활성' : '비활성'
}

function minioStatusLabel(resume) {
  return resume?.minio_uploaded_at || resume?.minio_key ? '저장 완료' : '저장 대기'
}

function airflowStatusLabel(resume) {
  return resume?.dag_triggered_at || resume?.dag_run_id ? '트리거 완료' : '트리거 대기'
}

function resumeSkillCount(resume) {
  return normalizeList(resume?.skills).length
}

function extractedResumeText(profile) {
  return String(profile?.raw_text || '').trim()
}

function hasExtractedResumeContent(profile) {
  return Boolean(normalizeList(profile?.skills).length || extractedResumeText(profile))
}

function resumeObjectName(resume) {
  if (resume?.minio_object_name) {
    return resume.minio_object_name
  }

  const parts = String(resume?.minio_key || '').split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1] : '미기록'
}

function clearSelectedResumeRecord() {
  state.selectedResumeRecordId = null
  state.selectedResumeRecord = null
  state.selectedResumeRecordProfile = null
  state.selectedResumeRecordLoading = false
  state.selectedResumeRecordError = ''
}

function formatExtractedTextLength(text) {
  return text ? `${text.length.toLocaleString('ko-KR')}자` : '미정'
}

function formatExtractedLineCount(text) {
  const count = splitTextLines(text).length
  return count ? `${count.toLocaleString('ko-KR')}줄` : '미정'
}

function renderHomeLink(extraClass = '') {
  const className = ['home-link', 'icon-button', extraClass].filter(Boolean).join(' ')

  return `
    <a class="${className}" href="/" aria-label="홈으로 이동">
      <svg class="home-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.75 10.5 12 3.75l8.25 6.75"></path>
        <path d="M6.75 9.75V20.25H17.25V9.75"></path>
        <path d="M10.5 20.25V14.25H13.5V20.25"></path>
      </svg>
    </a>
  `
}

function renderInlineChips(items, emptyLabel = '정보 없음') {
  const normalized = normalizeList(items).slice(0, 6)
  if (!normalized.length) {
    return `<span class="inline-chip muted">${escapeHtml(emptyLabel)}</span>`
  }

  return normalized.map((item) => `<span class="inline-chip">${escapeHtml(item)}</span>`).join('')
}

function jobSummary(job) {
  return job.summary || job.team_description || job.raw_description || job.responsibilities || '상세 설명이 아직 없습니다.'
}

function qualificationItems(job) {
  return splitTextLines(job.minimum_qualifications)
}

function preferredItems(job) {
  return splitTextLines(job.preferred_qualifications)
}

function favoriteEmptyMessage() {
  const hasActiveFilters = Boolean(
    state.searchKeyword.trim() ||
    state.selectedCompanies.length ||
    state.selectedSkills.length,
  )

  return hasActiveFilters
    ? '조건에 맞는 즐겨찾기 공고가 없습니다.'
    : '아직 즐겨찾기한 공고가 없습니다. 목록, 추천, 상세 화면의 별표로 저장해 보세요.'
}

function renderJobOpenButton(job) {
  return `
    <button
      class="secondary-button compact-button job-open-button"
      type="button"
      data-job-open="${escapeHtml(job.job_id)}"
      aria-label="${escapeHtml(`${job.title} 상세 보기`)}"
    >
      상세 보기
    </button>
  `
}

function renderJobCard(job) {
  return `
    <article
      class="job-card ${state.selectedJobId === job.job_id ? 'selected' : ''}"
      data-job-id="${escapeHtml(job.job_id)}"
    >
      ${renderJobCardHeader(job)}
      <p class="job-summary">${escapeHtml(jobSummary(job))}</p>
      ${
        job.recommendation_reason
          ? `<p class="job-reason">${escapeHtml(job.recommendation_reason)}</p>`
          : ''
      }
      <div class="job-chip-row">
        <span class="job-chip-label">Skills</span>
        <div class="inline-chip-list">
          ${renderInlineChips(job.matched_skills?.length ? job.matched_skills : job.skills, '스킬 없음')}
        </div>
      </div>
      <div class="job-chip-row">
        <span class="job-chip-label">Domains</span>
        <div class="inline-chip-list">
          ${renderInlineChips(job.matched_domains?.length ? job.matched_domains : job.domains, '도메인 없음')}
        </div>
      </div>
      <div class="job-card-actions">
        ${renderJobOpenButton(job)}
      </div>
    </article>
  `
}

function buildQuery({ includeKeyword = false } = {}) {
  const params = new URLSearchParams()
  params.set('page', String(state.page))
  params.set('page_size', String(state.pageSize))

  state.selectedCompanies.forEach((company) => {
    params.append('company', company)
  })
  state.selectedSkills.forEach((skill) => {
    params.append('skill', skill)
  })

  if (includeKeyword && state.searchKeyword.trim()) {
    params.set('q', state.searchKeyword.trim())
  }

  return params.toString()
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.message || `Request failed: ${response.status}`)
  }

  return response.json()
}

function applyResumePayload(payload) {
  if (Object.prototype.hasOwnProperty.call(payload, 'resume')) {
    state.resume = payload.resume || null
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'profile')) {
    state.resumeProfile = payload.profile || null
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'recommendation_ready')) {
    state.recommendationReady = payload.recommendation_ready === true
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'message')) {
    state.recommendationMessage = payload.message || ''
  }
}

function setFavoriteActionPending(jobId, isPending) {
  state.favoriteActionJobIds = isPending
    ? [...new Set([...state.favoriteActionJobIds, jobId])]
    : state.favoriteActionJobIds.filter((item) => item !== jobId)
}

function updateJobFavoriteState(jobId, isFavorited, favoritedAt) {
  state.jobs = state.jobs.map((job) =>
    job.job_id === jobId
      ? {
          ...job,
          is_favorited: isFavorited,
          favorited_at: favoritedAt,
        }
      : job,
  )

  if (state.selectedJob?.job_id === jobId) {
    state.selectedJob = {
      ...state.selectedJob,
      is_favorited: isFavorited,
      favorited_at: favoritedAt,
    }
  }
}

async function toggleFavorite(jobId, nextFavorite) {
  state.favoriteError = ''
  setFavoriteActionPending(jobId, true)
  render()

  try {
    const payload = await requestJson(`/api/jobs/${encodeURIComponent(jobId)}/favorite`, {
      method: nextFavorite ? 'PUT' : 'DELETE',
    })

    updateJobFavoriteState(jobId, payload.is_favorited === true, payload.favorited_at || null)

    if (state.activeTab === 'favorites' && payload.is_favorited !== true) {
      const jobCountBeforeRemoval = state.jobs.length
      state.jobs = state.jobs.filter((job) => job.job_id !== jobId)
      if (jobCountBeforeRemoval !== state.jobs.length) {
        state.total = Math.max(0, state.total - 1)
      }

      if (state.selectedJobId === jobId) {
        state.selectedJobId = null
        state.selectedJob = null
      }

      if (!state.jobs.length && state.page > 1) {
        state.page -= 1
        await loadJobs()
        return
      }
    }
  } catch (error) {
    state.favoriteError = error.message || '즐겨찾기 상태를 변경하지 못했습니다.'
  } finally {
    setFavoriteActionPending(jobId, false)
    render()
  }
}

function mergeResumeIntoList(resume) {
  if (!resume) {
    return
  }

  state.resumeList = state.resumeList.map((item) =>
    item.id === resume.id
      ? {
          ...item,
          ...resume,
          is_recommendation_source: item.is_recommendation_source,
        }
      : item,
  )
}

function syncSelectedResumeRecord() {
  state.selectedResumeRecord = state.resumeList.find((item) => item.id === state.selectedResumeRecordId) || null
}

async function loadLatestResume() {
  state.resumeLoading = true
  state.resumeError = ''
  render()

  try {
    const payload = await requestJson('/api/resumes/latest')
    applyResumePayload(payload)
  } catch (error) {
    if (String(error.message).includes('404')) {
      state.resume = null
      state.resumeProfile = null
      state.recommendationReady = false
      state.recommendationMessage = ''
    } else {
      state.resumeError = error.message || '이력서 정보를 불러오지 못했습니다.'
    }
  } finally {
    state.resumeLoading = false
    render()
  }
}

async function loadResumeList({ selectResumeId, preserveSelection = true } = {}) {
  state.resumeListLoading = true
  state.resumeListError = ''
  render()

  const previousSelectedId = state.selectedResumeRecordId

  try {
    const payload = await requestJson('/api/resumes')
    state.resumeList = payload.items || []

    const fallbackId = preserveSelection ? previousSelectedId : null
    const requestedSelectedId = selectResumeId === undefined ? fallbackId : selectResumeId
    const nextSelectedId = state.resumeList.some((item) => item.id === requestedSelectedId) ? requestedSelectedId : null

    state.selectedResumeRecordId = nextSelectedId
    syncSelectedResumeRecord()

    if (!nextSelectedId) {
      state.selectedResumeRecordProfile = null
      state.selectedResumeRecordError = ''
      state.selectedResumeRecordLoading = false
    } else if (nextSelectedId !== previousSelectedId) {
      state.selectedResumeRecordProfile = null
      state.selectedResumeRecordError = ''
    }
  } catch (error) {
    state.resumeList = []
    state.resumeListError = error.message || '이력서 목록을 불러오지 못했습니다.'
    clearSelectedResumeRecord()
  } finally {
    state.resumeListLoading = false
    render()
  }

  if (state.selectedResumeRecordId) {
    await loadResumeRecordDetail(state.selectedResumeRecordId)
  }
}

async function loadResumeRecordDetail(resumeId) {
  const selectingNewRecord = state.selectedResumeRecordId !== resumeId
  state.selectedResumeRecordId = resumeId
  syncSelectedResumeRecord()
  state.selectedResumeRecordLoading = true
  state.selectedResumeRecordError = ''
  if (selectingNewRecord) {
    state.selectedResumeRecordProfile = null
  }
  render()

  try {
    const payload = await requestJson(`/api/resumes/${encodeURIComponent(resumeId)}/profile`)
    state.selectedResumeRecord = payload.resume || state.selectedResumeRecord
    state.selectedResumeRecordProfile = payload.profile || null
    mergeResumeIntoList(payload.resume)
    syncSelectedResumeRecord()
  } catch (error) {
    state.selectedResumeRecordProfile = null
    state.selectedResumeRecordError = error.message || '이력서 상세 정보를 불러오지 못했습니다.'
  } finally {
    state.selectedResumeRecordLoading = false
    render()
  }
}

async function updateResumeActive(resumeId, isActive) {
  state.resumeActionId = resumeId
  state.resumeListError = ''
  render()

  try {
    const payload = await requestJson(`/api/resumes/${encodeURIComponent(resumeId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ is_active: isActive }),
    })

    mergeResumeIntoList(payload.resume)
    if (state.selectedResumeRecordId === resumeId) {
      state.selectedResumeRecord = {
        ...(state.selectedResumeRecord || {}),
        ...(payload.resume || {}),
      }
    }

    await loadLatestResume()
    await loadResumeList({ selectResumeId: resumeId })
  } catch (error) {
    state.resumeListError = error.message || '활성 상태를 변경하지 못했습니다.'
    render()
  } finally {
    state.resumeActionId = null
    render()
  }
}

async function loadJobs() {
  if (state.activeTab === 'manage') {
    render()
    return
  }

  state.loading = true
  state.error = ''
  state.favoriteError = ''
  render()

  try {
    const query = buildQuery({ includeKeyword: state.activeTab !== 'manage' })
    const endpoint =
      state.activeTab === 'recommend'
        ? `/api/jobs/recommendations?${query}`
        : state.activeTab === 'favorites'
          ? `/api/jobs/favorites?${query}`
          : state.searchKeyword.trim()
            ? `/api/jobs/search?${query}`
            : `/api/jobs?${query}`

    const payload = await requestJson(endpoint)
    state.jobs = payload.jobs || []
    state.total = payload.total || 0
    state.page = payload.page || 1
    state.pageSize = payload.page_size || state.pageSize
    state.companies = payload.companies || []
    state.skills = payload.skills || []
    state.source = payload.source || 'postgres'
    state.searchReady = payload.search_ready !== false

    applyResumePayload(payload)

    if (state.selectedJobId && !state.jobs.some((job) => job.job_id === state.selectedJobId)) {
      state.selectedJobId = null
      state.selectedJob = null
    }
  } catch (error) {
    state.jobs = []
    state.total = 0
    state.error = error.message || '데이터를 불러오지 못했습니다.'
    if (state.activeTab === 'recommend') {
      state.recommendationReady = false
    }
  } finally {
    state.loading = false
    render()
  }
}

async function loadJobDetail(jobId) {
  state.selectedJobId = jobId
  state.detailLoading = true
  state.error = ''
  render()

  try {
    const payload = await requestJson(`/api/jobs/${encodeURIComponent(jobId)}`)
    state.selectedJob = payload.job || null
  } catch (error) {
    state.selectedJob = null
    state.error = error.message || '상세 정보를 불러오지 못했습니다.'
  } finally {
    state.detailLoading = false
    render()
  }
}

async function uploadResume(file) {
  state.resumeUploading = true
  state.resumeError = ''
  state.resumeSuccess = ''
  render()

  try {
    const formData = new FormData()
    formData.append('file', file)
    const payload = await requestJson('/api/resumes', {
      method: 'POST',
      body: formData,
      headers: {},
    })

    applyResumePayload(payload)
    state.resumeSuccess = payload.warning
      ? `이력서를 업로드했고 MinIO에 저장했습니다. ${payload.warning}`
      : `이력서를 업로드했고 MinIO에 ${payload.resume?.minio_object_name || '새 object'}로 저장한 뒤 Airflow DAG 트리거를 요청했습니다.`
    await loadLatestResume()
    await loadResumeList({
      selectResumeId: null,
      preserveSelection: false,
    })
  } catch (error) {
    state.resumeError = error.message || '이력서 업로드에 실패했습니다.'
  } finally {
    state.resumeUploading = false
    render()
  }
}

function renderCompanyOptions() {
  const companies = sortOptionsWithSelected([...state.selectedCompanies, ...state.companies], state.selectedCompanies)

  if (companies.length === 0) {
    return '<p class="empty-hint">표시할 회사가 아직 없습니다.</p>'
  }

  return `
    <div class="toggle-row company-filter-list">
      ${companies
        .map(
          (company) => `
            <button
              class="toggle-chip company-filter-chip ${state.selectedCompanies.includes(company) ? 'active' : ''}"
              type="button"
              data-company="${escapeHtml(company)}"
            >
              ${escapeHtml(company)}
            </button>
          `,
        )
        .join('')}
    </div>
  `
}

function renderSkillOptions() {
  const skills = sortSkillOptions([...state.selectedSkills, ...state.skills])
  const resumeSkillSet = new Set(state.activeTab === 'recommend' ? resumeSuggestedSkills() : [])
  const visibleSkills = state.skillListExpanded ? skills : skills.slice(0, 30)

  if (skills.length === 0) {
    return '<p class="empty-hint">표시할 스킬이 아직 없습니다.</p>'
  }

  return `
    <div class="toggle-row skill-filter-list">
      ${visibleSkills
        .map(
          (skill) => `
            <button
              class="toggle-chip skill-filter-chip ${resumeSkillSet.has(skill) ? 'resume-suggested' : ''} ${state.selectedSkills.includes(skill) ? 'active' : ''}"
              type="button"
              data-skill="${escapeHtml(skill)}"
            >
              ${escapeHtml(skill)}
            </button>
          `,
        )
        .join('')}
    </div>
    ${
      skills.length > 30
        ? `
          <button class="filter-more-button" type="button" data-toggle-skill-list>
            ${state.skillListExpanded ? '접기' : `더 보기 (${skills.length - visibleSkills.length}개)`}
          </button>
        `
        : ''
    }
  `
}

function renderRecommendationState(message, { includeManageButton = false } = {}) {
  return `
    <div class="results-state">
      <div class="results-state-card">
        <p>${escapeHtml(message)}</p>
        ${
          includeManageButton
            ? `
              <div class="panel-actions centered-actions">
                <button class="primary-button" type="button" data-tab-jump="manage">이력서 관리로 이동</button>
              </div>
            `
            : ''
        }
      </div>
    </div>
  `
}

function renderJobs() {
  if (state.loading) {
    return '<div class="results-state">공고를 불러오는 중입니다.</div>'
  }

  if (state.activeTab === 'recommend' && !state.resume) {
    return renderRecommendationState('활성 이력서가 없습니다. 이력서 관리에서 이력서를 업로드하거나 활성화해 주세요.', {
      includeManageButton: true,
    })
  }

  if (state.activeTab === 'recommend' && !state.recommendationReady) {
    return renderRecommendationState(state.recommendationMessage || '이력서 추천을 준비 중입니다.')
  }

  if (state.jobs.length === 0) {
    return `<div class="results-state">${escapeHtml(state.activeTab === 'favorites' ? favoriteEmptyMessage() : '조건에 맞는 공고가 없습니다.')}</div>`
  }

  return `
    <div class="job-list">
      ${state.jobs.map((job) => renderJobCard(job)).join('')}
    </div>
  `
}

function renderTagList(items) {
  if (!items.length) {
    return '<p class="empty-hint compact">아직 추출된 항목이 없습니다.</p>'
  }

  return `
    <div class="tag-list">
      ${items.map((item) => `<span class="tag-chip">${escapeHtml(item)}</span>`).join('')}
    </div>
  `
}

function renderExperienceList(items) {
  if (!items.length) {
    return '<p class="empty-hint compact">표시할 경력 정보가 없습니다.</p>'
  }

  return `
    <div class="experience-list">
      ${items
        .map((item) => {
          const parts = [item.company, item.title].filter(Boolean).join(' · ')
          const summary = item.summary || ''
          const skills = normalizeList(item.skills)
          return `
            <article class="experience-card">
              <h4>${escapeHtml(parts || '경력 항목')}</h4>
              ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
              ${skills.length ? renderTagList(skills) : ''}
            </article>
          `
        })
        .join('')}
    </div>
  `
}

function renderProjects(items) {
  if (!items.length) {
    return '<p class="empty-hint compact">표시할 프로젝트가 없습니다.</p>'
  }

  return `
    <div class="experience-list">
      ${items
        .map((item) => `
          <article class="experience-card">
            <h4>${escapeHtml(item.name || '프로젝트')}</h4>
            ${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ''}
            ${normalizeList(item.skills).length ? renderTagList(normalizeList(item.skills)) : ''}
          </article>
        `)
        .join('')}
    </div>
  `
}

function renderResumeManagementControls() {
  return `
    <div class="control-stack">
      <div class="resume-placeholder">
        이력서 관리는 본문 화면에서 업로드, 상태 확인, 추출 내용 확인을 함께 제공합니다.
      </div>
    </div>
  `
}

function renderResumeRecordCard(resume) {
  const isSelected = state.selectedResumeRecordId === resume.id
  const isMutating = state.resumeActionId === resume.id

  return `
    <article class="resume-record-card ${isSelected ? 'selected' : ''}">
      <div class="resume-record-head">
        <button
          class="resume-record-summary"
          type="button"
          data-resume-select="${escapeHtml(resume.id)}"
          aria-expanded="${isSelected ? 'true' : 'false'}"
        >
          <div class="resume-record-copy">
            <div class="resume-record-title-row">
              <p class="detail-label">Resume #${escapeHtml(resume.id)}</p>
              <span class="field-meta">${escapeHtml(formatDateTime(resume.uploaded_at || resume.created_at))}</span>
            </div>
            <h3>${escapeHtml(resumeFilename(resume))}</h3>
            <div class="tag-list compact-tag-list">
              <span class="tag-chip">${escapeHtml(resumeStatusLabel(resume))}</span>
              <span class="tag-chip">${escapeHtml(resumeActiveLabel(resume))}</span>
              ${resume.is_recommendation_source ? '<span class="tag-chip">추천 기준</span>' : ''}
              ${resume.recommendation_ready ? '<span class="tag-chip">추천 준비 완료</span>' : ''}
            </div>
            <p class="resume-record-facts">
              <span>추천 ${escapeHtml(`${resume.recommendation_count}건`)}</span>
              <span>MinIO ${escapeHtml(minioStatusLabel(resume))}</span>
              <span>Airflow ${escapeHtml(airflowStatusLabel(resume))}</span>
            </p>
          </div>
          <span class="resume-record-toggle">${isSelected ? '접기' : '상세 보기'}</span>
        </button>

        <div class="resume-record-actions">
          <button
            class="secondary-button compact-button"
            type="button"
            data-resume-active="${escapeHtml(resume.id)}"
            data-next-active="${resume.is_active ? 'false' : 'true'}"
            ${isMutating ? 'disabled' : ''}
          >
            ${
              isMutating
                ? '변경 중...'
                : resume.is_active
                  ? '비활성화'
                  : '활성화'
            }
          </button>
        </div>
      </div>

      ${isSelected ? renderSelectedResumeRecordDetail() : resume.last_error ? `<div class="inline-message error compact-message">${escapeHtml(resume.last_error)}</div>` : ''}
    </article>
  `
}

function renderResumeRecordList() {
  if (state.resumeListLoading) {
    return '<div class="resume-placeholder">이력서 목록을 불러오는 중입니다.</div>'
  }

  if (state.resumeListError) {
    return `<div class="inline-message error">${escapeHtml(state.resumeListError)}</div>`
  }

  if (!state.resumeList.length) {
    return '<div class="resume-placeholder">업로드된 이력서가 아직 없습니다. 위에서 DOCX 파일을 올려 주세요.</div>'
  }

  return `
    <div class="resume-record-list">
      ${state.resumeList.map((resume) => renderResumeRecordCard(resume)).join('')}
    </div>
  `
}

function renderSelectedResumeRecordDetail() {
  const resume = state.selectedResumeRecord
  const profile = state.selectedResumeRecordProfile
  const profileSkills = normalizeList(profile?.skills)
  const rawText = extractedResumeText(profile)
  const hasContent = hasExtractedResumeContent(profile)

  if (!resume) {
    return ''
  }

  return `
    <section class="resume-detail-section">
      <div class="resume-detail-toolbar">
        <p class="eyebrow">Resume Detail</p>
        <button class="secondary-button compact-button" type="button" data-resume-refresh>새로고침</button>
      </div>

      ${
        state.selectedResumeRecordError
          ? `<div class="inline-message error">${escapeHtml(state.selectedResumeRecordError)}</div>`
          : ''
      }

      ${
        state.selectedResumeRecordLoading
          ? '<div class="resume-placeholder">선택한 이력서의 추출 내용을 불러오는 중입니다.</div>'
          : ''
      }

      <div class="resume-meta-grid compact-meta-grid">
        <div class="meta-card compact-meta-card">
          <p class="detail-label">현재 상태</p>
          <p>${escapeHtml(resumeStatusLabel(resume))}</p>
          <span class="field-meta">${escapeHtml(formatDateTime(resume.status_updated_at || resume.uploaded_at))}</span>
        </div>
        <div class="meta-card compact-meta-card">
          <p class="detail-label">활성 여부</p>
          <p>${escapeHtml(resumeActiveLabel(resume))}</p>
          <span class="field-meta">${escapeHtml(recommendationStatusLabel(resume))}</span>
        </div>
        <div class="meta-card compact-meta-card">
          <p class="detail-label">원본 파일명</p>
          <p class="mono-text">${escapeHtml(resumeFilename(resume))}</p>
        </div>
        <div class="meta-card compact-meta-card">
          <p class="detail-label">MinIO Object</p>
          <p class="mono-text">${escapeHtml(resumeObjectName(resume))}</p>
          <span class="field-meta mono-text">${escapeHtml(resume.minio_key || '미기록')}</span>
        </div>
        <div class="meta-card compact-meta-card">
          <p class="detail-label">DAG Run ID</p>
          <p class="mono-text">${escapeHtml(resume.dag_run_id || '미기록')}</p>
        </div>
        <div class="meta-card compact-meta-card">
          <p class="detail-label">추천 결과</p>
          <p>${escapeHtml(`${resume.recommendation_count}건`)}</p>
          <span class="field-meta">${escapeHtml(formatDateTime(resume.last_ranked_at))}</span>
        </div>
      </div>

      ${
        !hasContent && !state.selectedResumeRecordLoading
          ? `<div class="resume-placeholder">${escapeHtml(state.selectedResumeRecordError || resume.last_error || '아직 추출된 내용이 없습니다. 상태가 진행되면 추출 스킬과 원문이 여기에 표시됩니다.')}</div>`
          : ''
      }

      ${
        hasContent
          ? `
            <div class="resume-profile-grid resume-extract-grid">
              <section class="profile-card compact-profile-card">
                <div class="field-row">
                  <span class="field-label">Skills</span>
                  <span class="field-meta">${profileSkills.length}개</span>
                </div>
                ${renderTagList(profileSkills)}
              </section>

              <section class="profile-card compact-profile-card">
                <div class="field-row">
                  <span class="field-label">원문 길이</span>
                  <span class="field-meta">${escapeHtml(formatExtractedTextLength(rawText))}</span>
                </div>
                <p class="profile-summary">${escapeHtml(formatExtractedLineCount(rawText))}</p>
              </section>

              <section class="profile-card raw-text-card compact-profile-card">
                <div class="field-row">
                  <span class="field-label">Extracted Text</span>
                  <span class="field-meta">${escapeHtml(formatExtractedTextLength(rawText))}</span>
                </div>
                ${
                  rawText
                    ? `<pre class="raw-text-block">${escapeHtml(rawText)}</pre>`
                    : '<p class="empty-hint compact">원문 텍스트가 아직 준비되지 않았습니다.</p>'
                }
              </section>
            </div>
          `
          : ''
      }
    </section>
  `
}

function renderResumeManagementPanel() {
  const resume = state.resume

  return `
    <section class="panel resume-panel">
      <div class="resume-hero">
        <div>
          <p class="eyebrow">Resume Management</p>
          <h2>이력서 관리</h2>
          <p class="panel-copy">DOCX 업로드, MinIO 저장 확인, Airflow DAG 트리거 상태, 추출 결과를 한 화면에서 관리합니다.</p>
        </div>
        <div class="resume-status ${resume ? 'has-data' : ''}">
          <span class="status-dot"></span>
          <span>${resume ? escapeHtml(`${resumeFilename(resume)} · ${resumeStatusLabel(resume)}`) : '활성 이력서 없음'}</span>
        </div>
      </div>

      <form class="resume-upload-form" data-resume-form>
        <label class="upload-field">
          <span class="field-label">이력서 업데이트</span>
          <input type="file" accept=".docx" name="resume-file" ${state.resumeUploading ? 'disabled' : ''} />
        </label>
        <button class="primary-button" type="submit" ${state.resumeUploading ? 'disabled' : ''}>
          ${state.resumeUploading ? '업로드 중...' : '새 이력서 업로드'}
        </button>
      </form>

      ${state.resumeError ? `<div class="inline-message error">${escapeHtml(state.resumeError)}</div>` : ''}
      ${state.resumeSuccess ? `<div class="inline-message success">${escapeHtml(state.resumeSuccess)}</div>` : ''}

      ${
        state.resumeLoading
          ? '<div class="resume-placeholder">활성 이력서 정보를 불러오는 중입니다.</div>'
          : resume
            ? `
              <div class="resume-meta-grid">
                <div class="meta-card">
                  <p class="detail-label">활성 이력서</p>
                  <p>${escapeHtml(resumeFilename(resume))}</p>
                </div>
                <div class="meta-card">
                  <p class="detail-label">상태</p>
                  <p>${escapeHtml(resumeStatusLabel(resume))}</p>
                </div>
                <div class="meta-card">
                  <p class="detail-label">업로드 시각</p>
                  <p>${escapeHtml(formatDateTime(resume.uploaded_at || resume.created_at))}</p>
                </div>
                <div class="meta-card">
                  <p class="detail-label">추천 준비</p>
                  <p>${escapeHtml(recommendationStatusLabel(resume))}</p>
                </div>
              </div>
            `
            : '<div class="resume-placeholder">활성 이력서가 없습니다. 목록에서 활성화하거나 새 이력서를 업로드해 주세요.</div>'
      }

      <section class="resume-list-section">
        <div class="section-header">
          <div>
            <p class="eyebrow">Resume List</p>
            <h3>이력서 목록</h3>
          </div>
          <div class="resume-list-tools">
            <span class="field-meta">${state.resumeList.length}개</span>
            <button class="secondary-button" type="button" data-resume-refresh>목록 새로고침</button>
          </div>
        </div>
        ${renderResumeRecordList()}
      </section>

      ${renderSelectedResumeRecordDetail()}
    </section>
  `
}

function renderNavigation() {
  const items = availableTabs(state.isMobile).map((id) => [id, TAB_LABELS[id]])

  if (state.isMobile) {
    return `
      <nav class="top-nav panel mobile-nav">
        <div class="nav-mobile-copy">
          ${renderHomeLink()}
          <span class="nav-current-tab">${TAB_LABELS[state.activeTab] || TAB_LABELS.recommend}</span>
        </div>
        <button class="icon-button nav-menu-button" type="button" aria-label="메뉴 열기" data-open-mobile-menu>
          <span class="nav-menu-icon" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </span>
        </button>
      </nav>
    `
  }

  return `
    <nav class="top-nav panel">
      ${renderHomeLink()}
      <div class="nav-tabs">
        ${items
          .map(
            ([id, label]) => `
              <button class="nav-tab ${state.activeTab === id ? 'active' : ''}" type="button" data-tab="${id}">
                ${label}
              </button>
            `,
          )
          .join('')}
      </div>
    </nav>
  `
}

function renderSearchControls() {
  const skillCount = uniqueTextList([...state.selectedSkills, ...state.skills]).length

  return `
    <div class="control-stack">
      <div class="search-control-group">
        <div class="search-input-shell">
          <input class="text-input" type="text" placeholder="회사, 팀, 스킬, 키워드" value="${escapeHtml(state.draftKeyword)}" />
        </div>

        <div class="panel-divider" aria-hidden="true"></div>
      </div>

      <div class="field">
        <div class="field-row">
          <span class="field-label field-label-inline">회사 (${state.companies.length}개)</span>
        </div>
        ${renderCompanyOptions()}
      </div>

      <div class="field">
        <div class="field-row">
          <span class="field-label field-label-inline">Skill (${skillCount}개)</span>
          <button class="filter-inline-button" type="button" data-reset>초기화</button>
        </div>
        ${renderSkillOptions()}
      </div>
    </div>
  `
}

function renderSearchPanel() {
  return `
    <aside class="panel search-panel">
      ${renderSearchControls()}
    </aside>
  `
}

function renderRecommendationControls({ mobile = false } = {}) {
  const resume = state.resume

  if (!resume) {
    return `
      <div class="control-stack">
        <div class="resume-placeholder">
          ${mobile ? '추천은 활성 이력서를 등록한 뒤 사용할 수 있습니다.' : '추천을 사용하려면 활성 이력서를 업로드하거나 활성화해 주세요.'}
        </div>
      </div>
    `
  }

  return `
    <div class="control-stack">
      <section class="recommend-summary">
        <p class="detail-label">최근 이력서</p>
        <button
          class="resume-link-button"
          type="button"
          data-open-resume-manage="${escapeHtml(resume.id)}"
        >
          ${escapeHtml(resumeFilename(resume))}
        </button>
      </section>

      ${
        state.recommendationMessage
          ? `<div class="resume-placeholder">${escapeHtml(state.recommendationMessage)}</div>`
          : ''
      }

      ${renderSearchControls({ mobile })}
    </div>
  `
}

function renderRecommendationPanel() {
  return `
    <aside class="panel search-panel">
      ${renderRecommendationControls()}
    </aside>
  `
}

function renderResultsPanel() {
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize))
  const totalLabel = state.activeTab === 'favorites' ? `즐겨찾기 ${state.total}건` : `총 ${state.total}건`

  return `
    <section class="panel results-panel">
      <div class="results-header">
        <p class="results-total">${totalLabel}</p>
      </div>

      ${state.favoriteError ? `<div class="inline-message error">${escapeHtml(state.favoriteError)}</div>` : ''}

      ${
        state.error
          ? `<div class="results-state">${escapeHtml(state.error)}</div>`
          : (state.activeTab === 'search' || (state.activeTab === 'recommend' && state.searchKeyword.trim())) && !state.searchReady
            ? '<div class="results-state">검색 인덱스가 아직 준비되지 않아 빈 결과를 표시하고 있습니다.</div>'
            : renderJobs()
      }

      <div class="pagination">
        <button class="secondary-button" type="button" data-page="prev" ${state.page <= 1 ? 'disabled' : ''}>이전</button>
        <span class="page-indicator">${state.page} / ${totalPages}</span>
        <button class="secondary-button" type="button" data-page="next" ${state.page >= totalPages ? 'disabled' : ''}>다음</button>
      </div>
    </section>
  `
}

function renderMobileMenu() {
  if (!state.isMobile) {
    return ''
  }

  return `
    <div class="mobile-menu-shell ${state.mobileMenuOpen ? 'open' : ''}">
      <button class="mobile-menu-backdrop" type="button" aria-label="메뉴 닫기" data-close-mobile-menu></button>
      <aside class="mobile-menu-panel">
        <div class="mobile-menu-header">
          <div class="nav-mobile-copy">
            ${renderHomeLink()}
            <span class="nav-current-tab">${TAB_LABELS[state.activeTab] || TAB_LABELS.recommend}</span>
          </div>
          <button class="icon-button" type="button" data-close-mobile-menu>닫기</button>
        </div>
        <div class="mobile-menu-tabs">
          ${availableTabs(true)
            .map(
              (id) => `
                <button class="nav-tab ${state.activeTab === id ? 'active' : ''}" type="button" data-tab="${id}">
                  ${TAB_LABELS[id]}
                </button>
              `,
            )
            .join('')}
        </div>
        <div class="mobile-menu-content">
          ${
            state.activeTab === 'recommend'
              ? renderRecommendationControls({ mobile: true })
              : state.activeTab === 'manage'
                ? renderResumeManagementControls()
                : renderSearchControls()
          }
        </div>
      </aside>
    </div>
  `
}

function renderDrawer() {
  const job = state.selectedJob

  if (state.detailLoading) {
    return `
      <div class="drawer-shell open">
        <button class="drawer-backdrop" type="button" aria-label="상세 닫기" data-close-drawer></button>
        <aside class="drawer-panel">
          <div class="drawer-header">
            <div>
              <p class="eyebrow">Job Detail</p>
              <h2>상세 정보</h2>
            </div>
            <button class="icon-button" type="button" data-close-drawer>닫기</button>
          </div>
          <div class="drawer-state">상세 정보를 불러오는 중입니다.</div>
        </aside>
      </div>
    `
  }

  if (!job) {
    return `
      <div class="drawer-shell">
        <button class="drawer-backdrop" type="button" aria-label="상세 닫기"></button>
        <aside class="drawer-panel">
          <div class="drawer-header">
            <div>
              <p class="eyebrow">Job Detail</p>
              <h2>상세 정보</h2>
            </div>
            <button class="icon-button" type="button" data-close-drawer>닫기</button>
          </div>
          <div class="drawer-state">공고를 선택하면 상세 정보가 여기에 표시됩니다.</div>
        </aside>
      </div>
    `
  }

  const qualifications = qualificationItems(job)
  const preferred = preferredItems(job)

  return `
    <div class="drawer-shell open">
      <button class="drawer-backdrop" type="button" aria-label="상세 닫기" data-close-drawer></button>
      <aside class="drawer-panel">
        <div class="drawer-header">
          <div>
            <p class="eyebrow">Job Detail</p>
            <h2>${escapeHtml(job.title)}</h2>
          </div>
          <div class="drawer-header-actions">
            ${renderFavoriteButton(job, { context: 'detail' })}
            <button class="icon-button" type="button" data-close-drawer>닫기</button>
          </div>
        </div>

        <div class="drawer-content">
          <div class="detail-grid">
            <div>
              <p class="detail-label">회사</p>
              <p>${escapeHtml(job.company)}</p>
            </div>
            <div>
              <p class="detail-label">위치</p>
              <p>${escapeHtml(formatLocationList(job.locations))}</p>
            </div>
            <div>
              <p class="detail-label">팀</p>
              <p>${escapeHtml(job.display_team || '미정')}</p>
            </div>
            <div>
              <p class="detail-label">게시일</p>
              <p>${formatDate(job.posted_at)}</p>
            </div>
            <div>
              <p class="detail-label">즐겨찾기</p>
              <p>${job.is_favorited ? '저장됨' : '미저장'}</p>
              ${
                job.is_favorited && job.favorited_at
                  ? `<span class="field-meta">${escapeHtml(formatDateTime(job.favorited_at))}</span>`
                  : ''
              }
            </div>
          </div>

          <section class="detail-section">
            <p class="detail-label">요약</p>
            <p>${escapeHtml(jobSummary(job))}</p>
          </section>

          <section class="detail-section">
            <p class="detail-label">Responsibilities</p>
            <p>${escapeHtml(job.responsibilities || '정보 없음')}</p>
          </section>

          <section class="detail-section">
            <p class="detail-label">Qualification</p>
            ${
              qualifications.length
                ? `<ul class="detail-list">${qualifications.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
                : '<p>정보 없음</p>'
            }
          </section>

          <section class="detail-section">
            <p class="detail-label">Preferred</p>
            ${
              preferred.length
                ? `<ul class="detail-list">${preferred.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
                : '<p>정보 없음</p>'
            }
          </section>

          <section class="detail-section">
            <p class="detail-label">Skills</p>
            <p>${escapeHtml((job.skills || []).join(', ') || '정보 없음')}</p>
          </section>

          <a class="primary-button detail-link" href="${escapeHtml(job.url)}" target="_blank" rel="noreferrer">
            원문 공고 보기
          </a>
        </div>
      </aside>
    </div>
  `
}

function renderMainContent() {
  if (state.activeTab === 'manage') {
    return renderResumeManagementPanel()
  }

  if (state.isMobile) {
    return renderResultsPanel()
  }

  return `
    <div class="layout">
      ${state.activeTab === 'recommend' ? renderRecommendationPanel() : renderSearchPanel()}
      ${renderResultsPanel()}
    </div>
  `
}

function render() {
  root.innerHTML = `
    <div class="app-shell">
      <div class="ambient ambient-left"></div>
      <div class="ambient ambient-right"></div>
      <main class="page-stack">
        ${renderNavigation()}
        ${renderMainContent()}
      </main>
      ${renderMobileMenu()}
      ${renderDrawer()}
    </div>
  `

  bindEvents()
}

function executeSearch() {
  state.searchKeyword = state.draftKeyword.trim()
  state.page = 1
  state.selectedJobId = null
  state.selectedJob = null
  state.favoriteError = ''
  state.mobileMenuOpen = false
  loadJobs()
}

function resetSearch() {
  state.draftKeyword = ''
  state.searchKeyword = ''
  state.selectedCompanies = []
  state.selectedSkills = []
  state.skillListExpanded = false
  state.page = 1
  state.selectedJobId = null
  state.selectedJob = null
  state.favoriteError = ''
  state.mobileMenuOpen = false
  loadJobs()
}

function applyFilters() {
  state.page = 1
  state.selectedJobId = null
  state.selectedJob = null
  state.favoriteError = ''
  loadJobs()
}

async function openResumeInManage(resumeId) {
  state.activeTab = 'manage'
  state.page = 1
  state.selectedJobId = null
  state.selectedJob = null
  state.error = ''
  state.favoriteError = ''
  state.mobileMenuOpen = false
  persistActiveTab('manage')

  render()

  await loadLatestResume()
  await loadResumeList({
    selectResumeId: resumeId || null,
    preserveSelection: false,
  })
}

function switchTab(nextTab) {
  const normalizedTab = normalizeTab(nextTab, state.isMobile)
  if (!normalizedTab || normalizedTab === state.activeTab) {
    state.mobileMenuOpen = false
    render()
    return
  }

  state.activeTab = normalizedTab
  state.page = 1
  state.selectedJobId = null
  state.selectedJob = null
  state.error = ''
  state.favoriteError = ''
  state.mobileMenuOpen = false
  persistActiveTab(normalizedTab)

  render()

  if (normalizedTab === 'manage') {
    loadLatestResume().then(() => loadResumeList())
    return
  }

  loadJobs()
}

function bindEvents() {
  const keywordInput = root.querySelector('.text-input')
  const resetButton = root.querySelector('[data-reset]')
  const pageButtons = root.querySelectorAll('[data-page]')
  const companyButtons = root.querySelectorAll('[data-company]')
  const skillButtons = root.querySelectorAll('[data-skill]')
  const toggleSkillListButton = root.querySelector('[data-toggle-skill-list]')
  const jobButtons = root.querySelectorAll('[data-job-id]')
  const jobOpenButtons = root.querySelectorAll('[data-job-open]')
  const favoriteButtons = root.querySelectorAll('[data-favorite-job-id]')
  const closeButtons = root.querySelectorAll('[data-close-drawer]')
  const resumeForm = root.querySelector('[data-resume-form]')
  const resumeRefreshButtons = root.querySelectorAll('[data-resume-refresh]')
  const resumeSelectButtons = root.querySelectorAll('[data-resume-select]')
  const resumeActiveButtons = root.querySelectorAll('[data-resume-active]')
  const openResumeManageButtons = root.querySelectorAll('[data-open-resume-manage]')
  const tabButtons = root.querySelectorAll('[data-tab]')
  const tabJumpButtons = root.querySelectorAll('[data-tab-jump]')
  const openMobileMenuButton = root.querySelector('[data-open-mobile-menu]')
  const closeMobileMenuButtons = root.querySelectorAll('[data-close-mobile-menu]')

  keywordInput?.addEventListener('input', (event) => {
    state.draftKeyword = event.target.value
  })

  keywordInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      executeSearch()
    }
  })

  resetButton?.addEventListener('click', resetSearch)

  resumeRefreshButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      state.mobileMenuOpen = false
      await loadLatestResume()
      if (state.activeTab === 'manage') {
        await loadResumeList({ selectResumeId: state.selectedResumeRecordId })
      }
    })
  })

  skillButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      const skill = event.currentTarget.dataset.skill
      if (!skill) {
        return
      }

      if (state.selectedSkills.includes(skill)) {
        state.selectedSkills = state.selectedSkills.filter((item) => item !== skill)
      } else {
        state.selectedSkills = [...state.selectedSkills, skill]
      }

      applyFilters()
    })
  })

  toggleSkillListButton?.addEventListener('click', () => {
    state.skillListExpanded = !state.skillListExpanded
    render()
  })

  resumeSelectButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      const resumeId = Number(event.currentTarget.dataset.resumeSelect)
      if (!resumeId) {
        return
      }
      state.mobileMenuOpen = false
      if (state.selectedResumeRecordId === resumeId) {
        clearSelectedResumeRecord()
        render()
        return
      }
      loadResumeRecordDetail(resumeId)
    })
  })

  resumeActiveButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      const resumeId = Number(event.currentTarget.dataset.resumeActive)
      const nextActive = event.currentTarget.dataset.nextActive === 'true'
      if (!resumeId) {
        return
      }
      state.mobileMenuOpen = false
      updateResumeActive(resumeId, nextActive)
    })
  })

  openResumeManageButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      const resumeId = Number(event.currentTarget.dataset.openResumeManage)
      state.mobileMenuOpen = false
      openResumeInManage(resumeId)
    })
  })

  tabButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      switchTab(event.currentTarget.dataset.tab)
    })
  })

  tabJumpButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      switchTab(event.currentTarget.dataset.tabJump)
    })
  })

  companyButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      const company = event.currentTarget.dataset.company
      if (!company) {
        return
      }

      if (state.selectedCompanies.includes(company)) {
        state.selectedCompanies = state.selectedCompanies.filter((item) => item !== company)
      } else {
        state.selectedCompanies = [...state.selectedCompanies, company]
      }

      applyFilters()
    })
  })

  favoriteButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation()

      const jobId = event.currentTarget.dataset.favoriteJobId
      const nextFavorite = event.currentTarget.dataset.nextFavorite === 'true'
      if (!jobId) {
        return
      }

      state.mobileMenuOpen = false
      toggleFavorite(jobId, nextFavorite)
    })
  })

  jobOpenButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation()

      const jobId = event.currentTarget.dataset.jobOpen
      if (!jobId) {
        return
      }

      state.mobileMenuOpen = false
      loadJobDetail(jobId)
    })
  })

  pageButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      const direction = event.target.dataset.page
      const nextPage = direction === 'prev' ? state.page - 1 : state.page + 1
      const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize))
      if (nextPage < 1 || nextPage > totalPages) {
        return
      }
      state.page = nextPage
      loadJobs()
    })
  })

  jobButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      const jobId = event.currentTarget.dataset.jobId
      if (!jobId) {
        return
      }
      state.mobileMenuOpen = false
      loadJobDetail(jobId)
    })
  })

  openMobileMenuButton?.addEventListener('click', () => {
    state.mobileMenuOpen = true
    render()
  })

  closeMobileMenuButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.mobileMenuOpen = false
      render()
    })
  })

  closeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedJobId = null
      state.selectedJob = null
      render()
    })
  })

  resumeForm?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const fileInput = event.currentTarget.querySelector('input[name="resume-file"]')
    const file = fileInput?.files?.[0]

    if (!file) {
      state.resumeError = '업로드할 DOCX 파일을 선택해 주세요.'
      state.resumeSuccess = ''
      render()
      return
    }

    if (!file.name.toLowerCase().endsWith('.docx')) {
      state.resumeError = '현재는 DOCX 파일만 지원합니다.'
      state.resumeSuccess = ''
      render()
      return
    }

    await uploadResume(file)
  })
}

function syncViewportState(isMobile) {
  const nextTab = normalizeTab(state.activeTab, isMobile)
  const tabChanged = nextTab !== state.activeTab

  state.isMobile = isMobile
  state.mobileMenuOpen = false

  if (tabChanged) {
    state.activeTab = nextTab
    persistActiveTab(nextTab)
  }

  return tabChanged
}

const handleViewportChange = (event) => {
  const tabChanged = syncViewportState(event.matches)
  render()

  if (tabChanged && state.activeTab !== 'manage') {
    loadJobs()
  }
}

if (typeof MOBILE_VIEWPORT_QUERY.addEventListener === 'function') {
  MOBILE_VIEWPORT_QUERY.addEventListener('change', handleViewportChange)
} else {
  MOBILE_VIEWPORT_QUERY.addListener(handleViewportChange)
}

render()
loadLatestResume().then(() => {
  if (state.activeTab === 'manage') {
    loadResumeList()
    return
  }

  if (state.activeTab !== 'manage') {
    loadJobs()
  }
})
