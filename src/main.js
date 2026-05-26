const MOBILE_VIEWPORT_QUERY = window.matchMedia('(max-width: 980px)')

const TAB_LABELS = {
  search: '목록',
  recommend: '추천',
  update: '이력서 업데이트',
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
  return isMobile ? ['search', 'recommend'] : ['search', 'recommend', 'update']
}

function normalizeTab(tab, isMobile = MOBILE_VIEWPORT_QUERY.matches) {
  return availableTabs(isMobile).includes(tab) ? tab : 'search'
}

const state = {
  activeTab: normalizeTab(window.localStorage.getItem('job-web:active-tab') || 'search'),
  draftKeyword: '',
  searchKeyword: '',
  selectedCompanies: [],
  companies: [],
  jobs: [],
  total: 0,
  page: 1,
  pageSize: 12,
  selectedJobId: null,
  selectedJob: null,
  loading: false,
  detailLoading: false,
  error: '',
  searchReady: true,
  source: 'postgres',
  resume: null,
  resumeProfile: null,
  resumeLoading: false,
  resumeUploading: false,
  resumeError: '',
  resumeSuccess: '',
  isMobile: MOBILE_VIEWPORT_QUERY.matches,
  mobileMenuOpen: false,
}

window.localStorage.setItem('job-web:active-tab', state.activeTab)

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

function summarizeLocationList(locations, fallbackValue = '') {
  const labels = []

  normalizeList(locations).forEach((item) => {
    const label = extractLocationLabel(item)
    if (label && !labels.includes(label)) {
      labels.push(label)
    }
  })

  if (!labels.length && fallbackValue) {
    const fallbackLabel = extractLocationLabel(fallbackValue)
    if (fallbackLabel) {
      labels.push(fallbackLabel)
    }
  }

  if (!labels.length) {
    return '미정'
  }

  return labels.length === 1 ? labels[0] : `${labels[0]} 외 ${labels.length - 1}곳`
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

function formatYears(value) {
  if (value === null || value === undefined || value === '') {
    return '미정'
  }
  return `${value}년`
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

function buildQuery({ includeKeyword = false } = {}) {
  const params = new URLSearchParams()
  params.set('page', String(state.page))
  params.set('page_size', String(state.pageSize))

  state.selectedCompanies.forEach((company) => {
    params.append('company', company)
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

async function loadLatestResume() {
  state.resumeLoading = true
  state.resumeError = ''
  render()

  try {
    const payload = await requestJson('/api/resumes/latest')
    state.resume = payload.resume || null
    state.resumeProfile = payload.profile || null
  } catch (error) {
    if (String(error.message).includes('404')) {
      state.resume = null
      state.resumeProfile = null
    } else {
      state.resumeError = error.message || '이력서 정보를 불러오지 못했습니다.'
    }
  } finally {
    state.resumeLoading = false
    render()
  }
}

async function loadJobs() {
  if (state.activeTab === 'update') {
    render()
    return
  }

  if (state.activeTab === 'recommend' && !state.resumeProfile) {
    state.jobs = []
    state.total = 0
    state.error = ''
    state.loading = false
    render()
    return
  }

  state.loading = true
  state.error = ''
  render()

  try {
    const query = buildQuery({ includeKeyword: state.activeTab === 'search' })
    const endpoint =
      state.activeTab === 'recommend'
        ? `/api/jobs/recommendations?${query}`
        : state.searchKeyword.trim()
          ? `/api/jobs/search?${query}`
          : `/api/jobs?${query}`

    const payload = await requestJson(endpoint)
    state.jobs = payload.jobs || []
    state.total = payload.total || 0
    state.page = payload.page || 1
    state.pageSize = payload.page_size || state.pageSize
    state.companies = payload.companies || []
    state.source = payload.source || 'postgres'
    state.searchReady = payload.search_ready !== false

    if (payload.resume) {
      state.resume = payload.resume
    }
    if (payload.profile) {
      state.resumeProfile = payload.profile
    }

    if (state.selectedJobId && !state.jobs.some((job) => job.job_id === state.selectedJobId)) {
      state.selectedJobId = null
      state.selectedJob = null
    }
  } catch (error) {
    state.jobs = []
    state.total = 0
    state.error = error.message || '데이터를 불러오지 못했습니다.'
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

    state.resume = payload.resume || null
    state.resumeProfile = payload.profile || null
    state.resumeSuccess = '최신 이력서로 갱신했습니다. 처리 후 원본 파일은 서버에서 삭제됩니다.'
  } catch (error) {
    state.resumeError = error.message || '이력서 업로드에 실패했습니다.'
  } finally {
    state.resumeUploading = false
    render()
  }
}

function renderCompanyOptions() {
  if (state.companies.length === 0) {
    return '<p class="empty-hint">표시할 회사가 아직 없습니다.</p>'
  }

  return state.companies
    .map(
      (company) => `
        <label class="checkbox-item">
          <input
            type="checkbox"
            data-company="${escapeHtml(company)}"
            ${state.selectedCompanies.includes(company) ? 'checked' : ''}
          />
          <span>${escapeHtml(company)}</span>
        </label>
      `,
    )
    .join('')
}

function renderJobs() {
  if (state.activeTab === 'recommend' && !state.resumeProfile) {
    return `<div class="results-state">${state.isMobile ? '추천은 데스크탑에서 최신 이력서를 등록한 뒤 사용할 수 있습니다.' : '추천을 사용하려면 최신 이력서를 먼저 등록해 주세요.'}</div>`
  }

  if (state.loading) {
    return '<div class="results-state">공고를 불러오는 중입니다.</div>'
  }

  if (state.jobs.length === 0) {
    return '<div class="results-state">조건에 맞는 공고가 없습니다.</div>'
  }

  return `
    <div class="job-list">
      ${state.jobs
        .map(
          (job) => `
            <button class="job-card ${state.selectedJobId === job.job_id ? 'selected' : ''}" type="button" data-job-id="${escapeHtml(job.job_id)}">
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
                    <span>${escapeHtml(summarizeLocationList(job.locations, job.primary_location || job.location))}</span>
                    <span class="job-meta-divider">·</span>
                    <span>${formatCardDate(job.posted_at)}</span>
                  </div>
                  ${
                    job.recommendation_score
                      ? `<span class="recommendation-badge">${escapeHtml(job.recommendation_score)}</span>`
                      : ''
                  }
                </div>
              </div>
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
            </button>
          `,
        )
        .join('')}
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

function renderResumePanel() {
  const profile = state.resumeProfile
  const resume = state.resume

  return `
    <section class="panel resume-panel">
      <div class="resume-hero">
        <div>
          <p class="eyebrow">Resume Update</p>
          <h2>이력서 업데이트</h2>
          <p class="panel-copy">새 DOCX를 업로드하면 최신 이력서 profile로 갱신합니다. 처리 후 원본 파일은 서버에서 삭제합니다.</p>
        </div>
        <div class="resume-status ${resume ? 'has-data' : ''}">
          <span class="status-dot"></span>
          <span>${resume ? escapeHtml(resume.status || 'normalized') : '미등록'}</span>
        </div>
      </div>

      <form class="resume-upload-form" data-resume-form>
        <label class="upload-field">
          <span class="field-label">DOCX 파일</span>
          <input type="file" accept=".docx" name="resume-file" ${state.resumeUploading ? 'disabled' : ''} />
        </label>
        <button class="primary-button" type="submit" ${state.resumeUploading ? 'disabled' : ''}>
          ${state.resumeUploading ? '업로드 중...' : '최신 이력서로 업데이트'}
        </button>
      </form>

      ${state.resumeError ? `<div class="inline-message error">${escapeHtml(state.resumeError)}</div>` : ''}
      ${state.resumeSuccess ? `<div class="inline-message success">${escapeHtml(state.resumeSuccess)}</div>` : ''}

      ${
        state.resumeLoading
          ? '<div class="resume-placeholder">마지막 이력서를 불러오는 중입니다.</div>'
          : ''
      }

      ${
        !resume && !state.resumeLoading
          ? '<div class="resume-placeholder">아직 업로드된 이력서가 없습니다. 먼저 DOCX 파일을 올려 주세요.</div>'
          : ''
      }

      ${
        resume
          ? `
            <div class="resume-meta-grid">
              <div class="meta-card">
                <p class="detail-label">파일명</p>
                <p>${escapeHtml(resume.filename)}</p>
              </div>
              <div class="meta-card">
                <p class="detail-label">정제 방식</p>
                <p>${escapeHtml(resume.normalization_method || 'unknown')}</p>
              </div>
              <div class="meta-card">
                <p class="detail-label">업로드 시각</p>
                <p>${formatDate(resume.created_at)}</p>
              </div>
              <div class="meta-card">
                <p class="detail-label">저장 상태</p>
                <p>${escapeHtml(resume.storage_path || 'deleted')}</p>
              </div>
            </div>
          `
          : ''
      }

      ${
        profile
          ? `
            <div class="resume-profile-grid">
              <section class="profile-card profile-card-main">
                <p class="eyebrow">Profile</p>
                <h3>${escapeHtml(profile.candidate_name || '이름 미확인')}</h3>
                <p class="profile-title">${escapeHtml(profile.current_title || '현재 직함 정보 없음')}</p>
                <p class="profile-summary">${escapeHtml(profile.summary || '요약이 아직 없습니다.')}</p>
                <div class="profile-stats">
                  <div>
                    <span class="detail-label">경력</span>
                    <strong>${formatYears(profile.years_of_experience)}</strong>
                  </div>
                  <div>
                    <span class="detail-label">시니어리티</span>
                    <strong>${escapeHtml(profile.seniority || '미정')}</strong>
                  </div>
                </div>
              </section>

              <section class="profile-card">
                <div class="field-row">
                  <span class="field-label">Skills</span>
                  <span class="field-meta">${normalizeList(profile.skills).length}개</span>
                </div>
                ${renderTagList(normalizeList(profile.skills))}
              </section>

              <section class="profile-card">
                <div class="field-row">
                  <span class="field-label">Domains</span>
                  <span class="field-meta">${normalizeList(profile.domains).length}개</span>
                </div>
                ${renderTagList(normalizeList(profile.domains))}
              </section>

              <section class="profile-card">
                <div class="field-row">
                  <span class="field-label">Locations</span>
                  <span class="field-meta">${normalizeList(profile.locations).length}개</span>
                </div>
                ${renderTagList(normalizeList(profile.locations))}
              </section>

              <section class="profile-card">
                <div class="field-row">
                  <span class="field-label">경력 요약</span>
                  <span class="field-meta">${normalizeList(profile.experience_items).length}개</span>
                </div>
                ${renderExperienceList(normalizeList(profile.experience_items))}
              </section>

              <section class="profile-card">
                <div class="field-row">
                  <span class="field-label">프로젝트</span>
                  <span class="field-meta">${normalizeList(profile.projects).length}개</span>
                </div>
                ${renderProjects(normalizeList(profile.projects))}
              </section>
            </div>
          `
          : ''
      }
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
          <span class="nav-current-tab">${TAB_LABELS[state.activeTab] || TAB_LABELS.search}</span>
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
          <span class="field-label">회사</span>
          <span class="field-meta">${state.companies.length}개</span>
        </div>
        <div class="checkbox-list">
          ${renderCompanyOptions()}
        </div>
      </div>

      <div class="panel-actions">
        <button class="primary-button" type="button" data-search>검색</button>
        <button class="secondary-button" type="button" data-reset>초기화</button>
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
  const profile = state.resumeProfile
  const resume = state.resume

  if (!profile) {
    return `
      <div class="control-stack">
        <div class="resume-placeholder">
          ${mobile ? '추천은 데스크탑에서 최신 이력서를 등록한 뒤 사용할 수 있습니다.' : '추천을 사용하려면 먼저 최신 이력서를 업로드해 주세요.'}
        </div>
        ${
          mobile
            ? ''
            : `
              <div class="panel-actions">
                <button class="primary-button" type="button" data-tab-jump="update">이력서 업데이트로 이동</button>
              </div>
            `
        }
      </div>
    `
  }

  return `
    <div class="control-stack">
      <section class="recommend-summary">
        <p class="detail-label">최근 이력서</p>
        <h3>${escapeHtml(profile.candidate_name || resume?.filename || '최근 이력서')}</h3>
        <p class="recommend-copy">${escapeHtml(profile.summary || '요약이 아직 없습니다.')}</p>
      </section>

      <section class="field">
        <div class="field-row">
          <span class="field-label">핵심 Skills</span>
          <span class="field-meta">${normalizeList(profile.skills).length}개</span>
        </div>
        ${renderTagList(normalizeList(profile.skills))}
      </section>

      <section class="field">
        <div class="field-row">
          <span class="field-label">핵심 Domains</span>
          <span class="field-meta">${normalizeList(profile.domains).length}개</span>
        </div>
        ${renderTagList(normalizeList(profile.domains))}
      </section>

      <div class="field">
        <div class="field-row">
          <span class="field-label">회사</span>
          <span class="field-meta">${state.companies.length}개</span>
        </div>
        <div class="checkbox-list">
          ${renderCompanyOptions()}
        </div>
      </div>

      <div class="panel-actions">
        <button class="primary-button" type="button" data-recommend-refresh>추천 새로고침</button>
        ${mobile ? '' : '<button class="secondary-button" type="button" data-tab-jump="update">이력서 갱신</button>'}
      </div>
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

  return `
    <section class="panel results-panel">
      <div class="results-header">
        <p class="results-total">총 ${state.total}건</p>
      </div>

      ${
        state.error
          ? `<div class="results-state">${escapeHtml(state.error)}</div>`
          : state.activeTab === 'search' && !state.searchReady
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
            <span class="nav-current-tab">${TAB_LABELS[state.activeTab] || TAB_LABELS.search}</span>
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
          ${state.activeTab === 'recommend' ? renderRecommendationControls({ mobile: true }) : renderSearchControls()}
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
          <button class="icon-button" type="button" data-close-drawer>닫기</button>
        </div>

        <div class="drawer-content">
          <div class="detail-grid">
            <div>
              <p class="detail-label">회사</p>
              <p>${escapeHtml(job.company)}</p>
            </div>
            <div>
              <p class="detail-label">위치</p>
              <p>${escapeHtml(job.location || '미정')}</p>
            </div>
            <div>
              <p class="detail-label">팀</p>
              <p>${escapeHtml(job.display_team || '미정')}</p>
            </div>
            <div>
              <p class="detail-label">게시일</p>
              <p>${formatDate(job.posted_at)}</p>
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
  if (state.activeTab === 'update') {
    return renderResumePanel()
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
  state.mobileMenuOpen = false
  loadJobs()
}

function resetSearch() {
  state.draftKeyword = ''
  state.searchKeyword = ''
  state.selectedCompanies = []
  state.page = 1
  state.selectedJobId = null
  state.selectedJob = null
  state.mobileMenuOpen = false
  loadJobs()
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
  state.mobileMenuOpen = false
  window.localStorage.setItem('job-web:active-tab', normalizedTab)

  render()

  if (normalizedTab === 'update') {
    return
  }

  loadJobs()
}

function bindEvents() {
  const keywordInput = root.querySelector('.text-input')
  const searchButton = root.querySelector('[data-search]')
  const resetButton = root.querySelector('[data-reset]')
  const refreshButton = root.querySelector('[data-recommend-refresh]')
  const pageButtons = root.querySelectorAll('[data-page]')
  const companyCheckboxes = root.querySelectorAll('input[data-company]')
  const jobButtons = root.querySelectorAll('[data-job-id]')
  const closeButtons = root.querySelectorAll('[data-close-drawer]')
  const resumeForm = root.querySelector('[data-resume-form]')
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

  searchButton?.addEventListener('click', executeSearch)
  resetButton?.addEventListener('click', resetSearch)
  refreshButton?.addEventListener('click', () => {
    state.page = 1
    state.mobileMenuOpen = false
    loadJobs()
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

  companyCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener('change', (event) => {
      const company = event.target.dataset.company
      if (!company) {
        return
      }

      if (state.selectedCompanies.includes(company)) {
        state.selectedCompanies = state.selectedCompanies.filter((item) => item !== company)
      } else {
        state.selectedCompanies = [...state.selectedCompanies, company]
      }
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
    window.localStorage.setItem('job-web:active-tab', nextTab)
  }

  return tabChanged
}

const handleViewportChange = (event) => {
  const tabChanged = syncViewportState(event.matches)
  render()

  if (tabChanged && state.activeTab !== 'update') {
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
  if (state.activeTab !== 'update') {
    loadJobs()
  }
})
