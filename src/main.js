const mockJobs = [
  {
    id: 'job-1',
    company: 'OpenAI Korea',
    title: 'Frontend Engineer, Hiring Experience',
    location: 'Seoul, KR',
    team: 'Hiring Platform',
    description: '채용 탐색과 지원 전환율을 높이는 사용자 경험을 담당하는 팀입니다.',
    qualification: ['5+ years in frontend development', 'Strong React and TypeScript skills', 'Experience with search-driven interfaces'],
    preferred: ['Experience with Elasticsearch-backed products', 'Design systems experience'],
    originalUrl: 'https://example.com/jobs/job-1',
    postedAt: '2026-05-20T09:00:00Z',
    recommendationScore: 98,
  },
  {
    id: 'job-2',
    company: 'Coupang',
    title: 'Senior Product Engineer, Candidate Search',
    location: 'Seoul, KR',
    team: 'Talent Intelligence',
    description: '채용 데이터를 검색하고 추천하는 인터널 제품을 개발하는 팀입니다.',
    qualification: ['Experience building product UIs', 'Strong API integration experience'],
    preferred: ['Search relevance tuning', 'B2B workflow products'],
    originalUrl: 'https://example.com/jobs/job-2',
    postedAt: '2026-05-18T08:30:00Z',
    recommendationScore: 94,
  },
  {
    id: 'job-3',
    company: 'Toss',
    title: 'Frontend Developer, Growth Recruiting',
    location: 'Seoul, KR',
    team: 'People Platform',
    description: '빠르게 변화하는 채용 프로세스를 지원하는 내부 도구를 만드는 팀입니다.',
    qualification: ['Solid UI engineering fundamentals', 'Accessibility and responsive design'],
    preferred: ['Experience with analytics', 'Familiarity with experimentation'],
    originalUrl: 'https://example.com/jobs/job-3',
    postedAt: '2026-05-22T04:15:00Z',
    recommendationScore: 91,
  },
  {
    id: 'job-4',
    company: 'Kakao',
    title: 'Web Engineer, Career Products',
    location: 'Pangyo, KR',
    team: 'Career Services',
    description: '구직자와 채용담당자 모두를 위한 경력 서비스 경험을 개선하는 팀입니다.',
    qualification: ['Production React experience', 'Collaborative product development'],
    preferred: ['Search UI experience', 'SSR knowledge'],
    originalUrl: 'https://example.com/jobs/job-4',
    postedAt: '2026-05-14T02:00:00Z',
    recommendationScore: 87,
  },
  {
    id: 'job-5',
    company: 'Naver',
    title: 'Frontend Engineer, Job Discovery',
    location: 'Seongnam, KR',
    team: 'Discovery UX',
    description: '탐색, 필터링, 상세 확인까지 이어지는 구직 흐름을 설계하는 팀입니다.',
    qualification: ['Advanced JavaScript and TypeScript', 'Experience with large-scale web apps'],
    preferred: ['Search and recommendation domain knowledge', 'Performance optimization'],
    originalUrl: 'https://example.com/jobs/job-5',
    postedAt: '2026-05-23T01:45:00Z',
    recommendationScore: 89,
  },
  {
    id: 'job-6',
    company: 'Line Plus',
    title: 'Frontend Engineer, Talent Matching',
    location: 'Seoul, KR',
    team: 'Matching Experience',
    description: '이력서 기반 매칭 결과를 제품 안에서 자연스럽게 보여주는 팀입니다.',
    qualification: ['Experience with component-driven UIs', 'Hands-on REST API integration'],
    preferred: ['Recommendation systems exposure', 'Data-heavy interface design'],
    originalUrl: 'https://example.com/jobs/job-6',
    postedAt: '2026-05-21T11:20:00Z',
    recommendationScore: 92,
  },
]

const state = {
  draftKeyword: '',
  searchKeyword: '',
  selectedCompanies: [],
  companies: [],
  jobs: [],
  total: 0,
  page: 1,
  pageSize: 4,
  hasResume: true,
  selectedJobId: null,
}

const root = document.querySelector('#root')

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatDate(value) {
  return new Date(value).toLocaleDateString('ko-KR')
}

function getCompanyOptions(keyword) {
  const lowered = keyword.trim().toLowerCase()
  return mockJobs
    .filter((job) => {
      if (!lowered) {
        return true
      }
      const haystack = [job.title, job.team, job.description, job.company].join(' ').toLowerCase()
      return haystack.includes(lowered)
    })
    .map((job) => job.company)
    .filter((company, index, companies) => companies.indexOf(company) === index)
    .sort((left, right) => left.localeCompare(right))
}

function searchJobs() {
  const keyword = state.searchKeyword.trim().toLowerCase()
  const filtered = mockJobs.filter((job) => {
    const companyMatched = state.selectedCompanies.length === 0 || state.selectedCompanies.includes(job.company)
    const haystack = [job.title, job.team, job.description, job.company].join(' ').toLowerCase()
    const keywordMatched = !keyword || haystack.includes(keyword)
    return companyMatched && keywordMatched
  })

  const sorted = [...filtered].sort((left, right) => {
    if (!state.searchKeyword.trim() && state.selectedCompanies.length === 0) {
      if (state.hasResume) {
        return (right.recommendationScore || 0) - (left.recommendationScore || 0)
      }
      return Date.parse(right.postedAt) - Date.parse(left.postedAt)
    }

    const scoreGap = (right.recommendationScore || 0) - (left.recommendationScore || 0)
    if (scoreGap !== 0) {
      return scoreGap
    }
    return Date.parse(right.postedAt) - Date.parse(left.postedAt)
  })

  state.total = sorted.length
  const start = (state.page - 1) * state.pageSize
  state.jobs = sorted.slice(start, start + state.pageSize)
}

function getSelectedJob() {
  return mockJobs.find((job) => job.id === state.selectedJobId) || null
}

function renderCompanyOptions() {
  if (state.companies.length === 0) {
    return '<p class="empty-hint">현재 조건에 맞는 회사가 없습니다.</p>'
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
  if (state.jobs.length === 0) {
    return '<div class="results-state">조건에 맞는 공고가 없습니다.</div>'
  }

  return `
    <div class="job-list">
      ${state.jobs
        .map(
          (job) => `
            <button class="job-card ${state.selectedJobId === job.id ? 'selected' : ''}" type="button" data-job-id="${job.id}">
              <div class="job-card-header">
                <span class="company-pill">${escapeHtml(job.company)}</span>
                <span class="posted-at">${formatDate(job.postedAt)}</span>
              </div>
              <h3>${escapeHtml(job.title)}</h3>
              <p class="job-team">${escapeHtml(job.team)}</p>
              <p class="job-description">${escapeHtml(job.description)}</p>
            </button>
          `,
        )
        .join('')}
    </div>
  `
}

function renderDrawer() {
  const job = getSelectedJob()
  const isOpen = Boolean(job)

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

  return `
    <div class="drawer-shell ${isOpen ? 'open' : ''}">
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
              <p>${escapeHtml(job.location)}</p>
            </div>
            <div>
              <p class="detail-label">팀</p>
              <p>${escapeHtml(job.team)}</p>
            </div>
            <div>
              <p class="detail-label">게시일</p>
              <p>${formatDate(job.postedAt)}</p>
            </div>
          </div>

          <section class="detail-section">
            <p class="detail-label">어떤 팀인지</p>
            <p>${escapeHtml(job.description)}</p>
          </section>

          <section class="detail-section">
            <p class="detail-label">Qualification</p>
            <ul class="detail-list">
              ${job.qualification.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
          </section>

          <section class="detail-section">
            <p class="detail-label">Preferred</p>
            <ul class="detail-list">
              ${job.preferred.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
          </section>

          <a class="primary-button detail-link" href="${job.originalUrl}" target="_blank" rel="noreferrer">
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
            <p class="panel-copy">검색어와 회사 필터로 원하는 공고를 빠르게 좁혀보세요.</p>
          </div>

          <label class="field">
            <span class="field-label">검색어</span>
            <input class="text-input" type="text" placeholder="회사, 팀, 키워드" value="${escapeHtml(state.draftKeyword)}" />
          </label>

          <div class="field">
            <div class="field-row">
              <span class="field-label">이력서 상태</span>
              <span class="field-meta">${state.hasResume ? '추천순' : '최신순'}</span>
            </div>
            <div class="toggle-row">
              <button class="toggle-chip ${state.hasResume ? 'active' : ''}" type="button" data-resume="true">이력서 있음</button>
              <button class="toggle-chip ${!state.hasResume ? 'active' : ''}" type="button" data-resume="false">이력서 없음</button>
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
              <p class="eyebrow">${state.hasResume ? 'Resume Ranking' : 'Latest Postings'}</p>
              <h2>검색 결과</h2>
            </div>
            <p class="results-meta">총 ${state.total}건</p>
          </div>

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
  state.searchKeyword = state.draftKeyword
  state.page = 1
  state.companies = getCompanyOptions(state.searchKeyword)
  state.selectedCompanies = state.selectedCompanies.filter((company) => state.companies.includes(company))
  state.selectedJobId = null
  searchJobs()
  render()
}

function resetSearch() {
  state.draftKeyword = ''
  state.searchKeyword = ''
  state.selectedCompanies = []
  state.selectedJobId = null
  state.page = 1
  state.companies = getCompanyOptions('')
  searchJobs()
  render()
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
      state.selectedJobId = null
      state.page = 1
      searchJobs()
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
      searchJobs()
      render()
    })
  })

  jobButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      state.selectedJobId = event.currentTarget.dataset.jobId
      render()
    })
  })

  closeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedJobId = null
      render()
    })
  })
}

state.hasResume = window.localStorage.getItem('job-web:resume') !== 'false'
state.companies = getCompanyOptions('')
searchJobs()
render()
