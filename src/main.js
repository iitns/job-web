const state = {
  activeTab: window.localStorage.getItem('job-web:active-tab') || 'search',
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

function normalizeList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

function formatYears(value) {
  if (value === null || value === undefined || value === '') {
    return '미정'
  }
  return `${value}년`
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
                <div class="company-lockup">
                  ${
                    job.company_logo_url
                      ? `<img class="company-logo" src="${escapeHtml(job.company_logo_url)}" alt="${escapeHtml(job.company)} 로고" loading="lazy" />`
                      : `<span class="company-logo fallback">${escapeHtml(job.company_mark || '?')}</span>`
                  }
                  <div class="job-card-titleblock">
                    <div class="job-card-meta">
                      <span class="job-meta-strong">${escapeHtml(job.company)}</span>
                      <span class="job-meta-divider">·</span>
                      <span>${escapeHtml(job.title)}</span>
                      <span class="job-meta-divider">·</span>
                      <span>${escapeHtml(job.display_team || '팀 정보 없음')}</span>
                      <span class="job-meta-divider">·</span>
                      <span>${escapeHtml(job.primary_location || '지역 미정')}</span>
                      <span class="job-meta-divider">·</span>
                      <span>${formatDate(job.posted_at)}</span>
                    </div>
                  </div>
                </div>
                ${
                  job.recommendation_score
                    ? `<span class="recommendation-badge">${escapeHtml(job.recommendation_score)}</span>`
                    : ''
                }
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
  const items = [
    ['search', '검색'],
    ['recommend', '추천'],
    ['update', '이력서 업데이트'],
  ]

  return `
    <nav class="top-nav panel">
      <div class="nav-brand">
        <p class="eyebrow">Job Web</p>
        <h1>채용 탐색</h1>
      </div>
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

function renderSearchPanel() {
  return `
    <aside class="panel search-panel">
      <div class="panel-header">
        <p class="eyebrow">Search</p>
        <h2>키워드와 필터</h2>
        <p class="panel-copy">검색은 키워드와 회사 필터만 사용합니다.</p>
      </div>

      <label class="field">
        <span class="field-label">검색어</span>
        <input class="text-input" type="text" placeholder="회사, 팀, 스킬, 키워드" value="${escapeHtml(state.draftKeyword)}" />
      </label>

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
  `
}

function renderRecommendationPanel() {
  const profile = state.resumeProfile
  const resume = state.resume

  if (!profile) {
    return `
      <aside class="panel search-panel">
        <div class="panel-header">
          <p class="eyebrow">Recommend</p>
          <h2>이력서 기반 추천</h2>
          <p class="panel-copy">최신 이력서를 바탕으로 공고를 추천합니다.</p>
        </div>
        <div class="resume-placeholder">
          추천을 사용하려면 먼저 최신 이력서를 업로드해 주세요.
        </div>
        <div class="panel-actions">
          <button class="primary-button" type="button" data-tab-jump="update">이력서 업데이트로 이동</button>
        </div>
      </aside>
    `
  }

  return `
    <aside class="panel search-panel">
      <div class="panel-header">
        <p class="eyebrow">Recommend</p>
        <h2>이력서 기반 추천</h2>
        <p class="panel-copy">최신 이력서 profile과 공고 필드를 비교해서 우선순위를 정합니다.</p>
      </div>

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
          <span class="field-label">회사 필터</span>
          <span class="field-meta">${state.companies.length}개</span>
        </div>
        <div class="checkbox-list">
          ${renderCompanyOptions()}
        </div>
      </div>

      <div class="panel-actions">
        <button class="primary-button" type="button" data-recommend-refresh>추천 새로고침</button>
        <button class="secondary-button" type="button" data-tab-jump="update">이력서 갱신</button>
      </div>
    </aside>
  `
}

function renderResultsPanel() {
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize))
  const eyebrow =
    state.activeTab === 'recommend'
      ? 'Resume Recommendation'
      : state.source === 'elasticsearch'
        ? 'Elasticsearch Search'
        : 'PostgreSQL Listing'
  const title = state.activeTab === 'recommend' ? '추천 공고' : '검색 결과'

  return `
    <section class="panel results-panel">
      <div class="results-header">
        <div>
          <p class="eyebrow">${eyebrow}</p>
          <h2>${title}</h2>
        </div>
        <p class="results-meta">총 ${state.total}건</p>
      </div>

      ${state.error ? `<div class="results-state">${escapeHtml(state.error)}</div>` : ''}
      ${state.activeTab === 'search' && !state.searchReady ? '<div class="results-state">검색 인덱스가 아직 준비되지 않아 빈 결과를 표시하고 있습니다.</div>' : ''}

      ${renderJobs()}

      <div class="pagination">
        <button class="secondary-button" type="button" data-page="prev" ${state.page <= 1 ? 'disabled' : ''}>이전</button>
        <span class="page-indicator">${state.page} / ${totalPages}</span>
        <button class="secondary-button" type="button" data-page="next" ${state.page >= totalPages ? 'disabled' : ''}>다음</button>
      </div>
    </section>
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
  loadJobs()
}

function resetSearch() {
  state.draftKeyword = ''
  state.searchKeyword = ''
  state.selectedCompanies = []
  state.page = 1
  state.selectedJobId = null
  state.selectedJob = null
  loadJobs()
}

function switchTab(nextTab) {
  if (!nextTab || nextTab === state.activeTab) {
    return
  }

  state.activeTab = nextTab
  state.page = 1
  state.selectedJobId = null
  state.selectedJob = null
  state.error = ''
  window.localStorage.setItem('job-web:active-tab', nextTab)

  render()

  if (nextTab === 'update') {
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

render()
loadLatestResume().then(() => {
  if (state.activeTab !== 'update') {
    loadJobs()
  }
})
