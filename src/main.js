const state = {
  draftKeyword: '',
  searchKeyword: '',
  selectedCompanies: [],
  companies: [],
  jobs: [],
  total: 0,
  page: 1,
  pageSize: 12,
  hasResume: true,
  selectedJobId: null,
  selectedJob: null,
  loading: false,
  detailLoading: false,
  error: '',
  searchReady: true,
  source: 'postgres',
}

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
  if (!value) {
    return '미정'
  }

  return new Date(value).toLocaleDateString('ko-KR')
}

function splitTextLines(value) {
  return String(value || '')
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function jobSummary(job) {
  return job.team_description || job.raw_description || job.responsibilities || '상세 설명이 아직 없습니다.'
}

function qualificationItems(job) {
  return splitTextLines(job.minimum_qualifications)
}

function preferredItems(job) {
  return splitTextLines(job.preferred_qualifications)
}

function buildQuery() {
  const params = new URLSearchParams()
  params.set('page', String(state.page))
  params.set('page_size', String(state.pageSize))

  state.selectedCompanies.forEach((company) => {
    params.append('company', company)
  })

  if (state.searchKeyword.trim()) {
    params.set('q', state.searchKeyword.trim())
  }

  return params.toString()
}

async function requestJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.message || `Request failed: ${response.status}`)
  }

  return response.json()
}

async function loadJobs() {
  state.loading = true
  state.error = ''
  render()

  try {
    const query = buildQuery()
    const endpoint = state.searchKeyword.trim() ? `/api/jobs/search?${query}` : `/api/jobs?${query}`
    const payload = await requestJson(endpoint)

    state.jobs = payload.jobs || []
    state.total = payload.total || 0
    state.page = payload.page || 1
    state.pageSize = payload.page_size || state.pageSize
    state.companies = payload.companies || []
    state.source = payload.source || 'postgres'
    state.searchReady = payload.search_ready !== false

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
              <div class="job-card-header">
                <span class="company-pill">${escapeHtml(job.company)}</span>
                <span class="posted-at">${formatDate(job.posted_at)}</span>
              </div>
              <h3>${escapeHtml(job.title)}</h3>
              <p class="job-team">${escapeHtml(job.team || job.level_guess || '팀 정보 없음')}</p>
              <p class="job-description">${escapeHtml(jobSummary(job))}</p>
            </button>
          `,
        )
        .join('')}
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
              <p>${escapeHtml(job.team || job.level_guess || '미정')}</p>
            </div>
            <div>
              <p class="detail-label">게시일</p>
              <p>${formatDate(job.posted_at)}</p>
            </div>
          </div>

          <section class="detail-section">
            <p class="detail-label">설명</p>
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

function render() {
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize))

  root.innerHTML = `
    <div class="app-shell">
      <div class="ambient ambient-left"></div>
      <div class="ambient ambient-right"></div>
      <main class="layout">
        <aside class="panel search-panel">
          <div class="panel-header">
            <p class="eyebrow">Search</p>
            <h1>Job Finder</h1>
            <p class="panel-copy">PostgreSQL 목록과 Elasticsearch 검색 결과를 하나의 화면에서 확인합니다.</p>
          </div>

          <label class="field">
            <span class="field-label">검색어</span>
            <input class="text-input" type="text" placeholder="회사, 팀, 스킬, 키워드" value="${escapeHtml(state.draftKeyword)}" />
          </label>

          <div class="field">
            <div class="field-row">
              <span class="field-label">정렬 상태</span>
              <span class="field-meta">${state.searchKeyword.trim() ? 'Elasticsearch 검색' : 'PostgreSQL 목록'}</span>
            </div>
            <div class="toggle-row">
              <button class="toggle-chip ${state.hasResume ? 'active' : ''}" type="button" data-resume="true">검색 사용</button>
              <button class="toggle-chip ${!state.hasResume ? 'active' : ''}" type="button" data-resume="false">목록만 보기</button>
            </div>
          </div>

          <div class="field">
            <div class="field-row">
              <span class="field-label">회사 필터</span>
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
        </aside>

        <section class="panel results-panel">
          <div class="results-header">
            <div>
              <p class="eyebrow">${state.source === 'elasticsearch' ? 'Elasticsearch Search' : 'PostgreSQL Listing'}</p>
              <h2>검색 결과</h2>
            </div>
            <p class="results-meta">총 ${state.total}건</p>
          </div>

          ${state.error ? `<div class="results-state">${escapeHtml(state.error)}</div>` : ''}
          ${!state.searchReady ? '<div class="results-state">검색 인덱스가 아직 준비되지 않아 빈 결과를 표시하고 있습니다.</div>' : ''}

          ${renderJobs()}

          <div class="pagination">
            <button class="secondary-button" type="button" data-page="prev" ${state.page <= 1 ? 'disabled' : ''}>이전</button>
            <span class="page-indicator">${state.page} / ${totalPages}</span>
            <button class="secondary-button" type="button" data-page="next" ${state.page >= totalPages ? 'disabled' : ''}>다음</button>
          </div>
        </section>
      </main>
      ${renderDrawer()}
    </div>
  `

  bindEvents()
}

function executeSearch() {
  state.searchKeyword = state.hasResume ? state.draftKeyword.trim() : ''
  state.page = 1
  state.selectedJobId = null
  state.selectedJob = null
  loadJobs()
}

function resetSearch() {
  state.draftKeyword = ''
  state.searchKeyword = ''
  state.selectedCompanies = []
  state.selectedJobId = null
  state.selectedJob = null
  state.page = 1
  loadJobs()
}

function bindEvents() {
  const keywordInput = root.querySelector('.text-input')
  const searchButton = root.querySelector('[data-search]')
  const resetButton = root.querySelector('[data-reset]')
  const pageButtons = root.querySelectorAll('[data-page]')
  const companyCheckboxes = root.querySelectorAll('input[data-company]')
  const jobButtons = root.querySelectorAll('[data-job-id]')
  const closeButtons = root.querySelectorAll('[data-close-drawer]')
  const resumeButtons = root.querySelectorAll('[data-resume]')

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

  resumeButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      state.hasResume = event.currentTarget.dataset.resume === 'true'
      window.localStorage.setItem('job-web:resume', String(state.hasResume))
      if (!state.hasResume) {
        state.searchKeyword = ''
      }
      render()
    })
  })

  pageButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      const direction = event.target.dataset.page
      const nextPage = direction === 'prev' ? state.page - 1 : state.page + 1
      if (nextPage < 1) {
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
      loadJobDetail(jobId)
    })
  })

  closeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedJobId = null
      state.selectedJob = null
      render()
    })
  })
}

state.hasResume = window.localStorage.getItem('job-web:resume') !== 'false'
render()
loadJobs()
