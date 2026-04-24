(function () {
  const INITIAL_BOARD_SETTINGS = typeof getDefaultContractBoardSettings === 'function'
    ? getDefaultContractBoardSettings()
    : { columns: [], tags: [], owners: [], departments: [], riskLevels: [], fileTypes: [] };
  const INITIAL_SAVED_VIEWS = typeof getDefaultContractSavedViews === 'function'
    ? getDefaultContractSavedViews()
    : [];
  const CONTRACT_DENSITY_KEY = 'dailyPlanner_contractDensity';
  const CONTRACT_VIEW_KEY = 'dailyPlanner_contractView';
  const CONTRACT_MY_OWNER_KEY = 'dailyPlanner_contractMyOwner';
  const FILE_GROUPS = [
    { id: 'primary', label: 'Primary agreement' },
    { id: 'amendments', label: 'Amendments' },
    { id: 'schedules', label: 'Schedules' },
    { id: 'reference', label: 'Reference links' }
  ];

  const ContractsState = window.ContractsState || {};
  Object.assign(ContractsState, {
    contracts: ContractsState.contracts || [],
    boardSettings: ContractsState.boardSettings || INITIAL_BOARD_SETTINGS,
    savedViews: ContractsState.savedViews || INITIAL_SAVED_VIEWS,
    contractsLoaded: !!ContractsState.contractsLoaded,
    settingsLoaded: !!ContractsState.settingsLoaded,
    viewsLoaded: !!ContractsState.viewsLoaded,
    searchQuery: '',
    filterTag: '',
    filterOwner: '',
    filterRisk: '',
    activeView: getStoredValue(CONTRACT_VIEW_KEY, 'all'),
    densityMode: getStoredValue(CONTRACT_DENSITY_KEY, 'detailed'),
    preferredOwner: getStoredValue(CONTRACT_MY_OWNER_KEY, ''),
    panelOpen: false,
    activeContractId: null,
    draft: null,
    fileDraft: null,
    editingFileId: null,
    settingsOpen: false,
    settingsDraft: null,
    draggedContractId: null,
    suppressCardOpen: false,
    hashHandled: false
  });
  window.ContractsState = ContractsState;

  function getStoredValue(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch (error) {
      return fallback;
    }
  }

  function setStoredValue(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.error('Storage error:', error);
    }
  }

  function isContractsPage() {
    return !!document.getElementById('contracts-board');
  }

  function createEmptyFileDraft(file) {
    const source = file || {};
    return {
      id: source.id || null,
      label: source.label || '',
      url: source.url || '',
      type: source.type || '',
      version: source.version || '',
      owner: source.owner || '',
      group: source.group || 'reference',
      note: source.note || '',
      isPrimary: !!source.isPrimary,
      dateAdded: source.dateAdded || source.addedAt || null,
      dateUpdated: source.dateUpdated || null
    };
  }

  function getNormalizedContractSettings() {
    return normalizeContractBoardSettings(ContractsState.boardSettings);
  }

  function getSavedContractViews() {
    return Array.isArray(ContractsState.savedViews) && ContractsState.savedViews.length
      ? ContractsState.savedViews
      : INITIAL_SAVED_VIEWS;
  }

  function getActiveSavedView() {
    const views = getSavedContractViews();
    return views.find(view => view.id === ContractsState.activeView) || views[0] || {
      id: 'all',
      label: 'All active',
      filters: { archived: 'active' },
      sort: 'board'
    };
  }

  function getContractColumns() {
    return getNormalizedContractSettings().columns;
  }

  function getActiveContractColumns() {
    return getContractColumns().filter(column => column.id !== CONTRACT_ARCHIVED_COLUMN_ID);
  }

  function getArchivedContractColumn() {
    return getContractColumns().find(column => column.id === CONTRACT_ARCHIVED_COLUMN_ID);
  }

  function getDefaultContractColumnId() {
    return (getActiveContractColumns()[0] || getArchivedContractColumn() || { id: 'intake' }).id;
  }

  function getLibraryItems(key) {
    return getNormalizedContractSettings()[key] || [];
  }

  function buildContractDraft(source) {
    return normalizeContract({
      title: '',
      counterparty: '',
      owner: '',
      columnId: getDefaultContractColumnId(),
      previousColumnId: getDefaultContractColumnId(),
      sortOrder: 0,
      tags: [],
      contractValue: '',
      department: '',
      contactName: '',
      contactEmail: '',
      riskLevel: '',
      reviewDeadline: null,
      signatureDate: null,
      nextAction: '',
      nextActionDate: null,
      effectiveDate: null,
      renewalDate: null,
      statusNote: '',
      notes: '',
      archived: false,
      archivedAt: null,
      createdAt: null,
      updatedAt: null,
      files: [],
      activity: [],
      ...source
    });
  }

  function getContractTagMap() {
    const map = new Map();
    getLibraryItems('tags').forEach(tag => map.set(tag.id, tag));
    return map;
  }

  function getContractTag(tagId) {
    return getContractTagMap().get(tagId) || null;
  }

  function getContractDisplayTag(tagId) {
    const knownTag = getContractTag(tagId);
    if (knownTag) return knownTag;
    return { id: tagId, label: tagId, color: '#6366f1' };
  }

  function getRiskLevel(riskId) {
    return getLibraryItems('riskLevels').find(level => level.id === riskId || level.label === riskId) || null;
  }

  function getFileTypeLabel(typeId) {
    const type = getLibraryItems('fileTypes').find(item => item.id === typeId || item.label === typeId);
    return type ? type.label : typeId;
  }

  function getContractColumnById(columnId) {
    return getContractColumns().find(column => column.id === columnId) || null;
  }

  function getContractColumnLabel(columnId) {
    const column = getContractColumnById(columnId);
    return column ? column.label : 'Unknown';
  }

  function getUniqueContractValues(field, libraryKey) {
    const values = new Set();
    getLibraryItems(libraryKey || '').forEach(item => values.add(item.label));
    ContractsState.contracts.forEach(contract => {
      const value = String(contract[field] || '').trim();
      if (value) values.add(value);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }

  function getPreferredOwner() {
    if (ContractsState.preferredOwner) return ContractsState.preferredOwner;
    if (ContractsState.filterOwner) return ContractsState.filterOwner;
    const ownerCounts = new Map();
    ContractsState.contracts.forEach(contract => {
      const owner = String(contract.owner || '').trim();
      if (!owner) return;
      ownerCounts.set(owner, (ownerCounts.get(owner) || 0) + 1);
    });
    return Array.from(ownerCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  }

  function getContractSearchValues(contract) {
    const tagLabels = (contract.tags || []).map(tagId => getContractDisplayTag(tagId).label).join(' ');
    const fileLabels = (contract.files || [])
      .map(file => [file.label, file.type, file.version, file.owner, file.note, file.url].filter(Boolean).join(' '))
      .join(' ');
    return [
      contract.title,
      contract.counterparty,
      contract.owner,
      contract.department,
      contract.contactName,
      contract.contactEmail,
      contract.riskLevel,
      contract.contractValue,
      contract.nextAction,
      contract.statusNote,
      contract.notes,
      tagLabels,
      fileLabels
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function isDateWithinDays(dateStr, days) {
    if (!dateStr) return false;
    const date = parseDateOnly(dateStr);
    if (Number.isNaN(date.getTime())) return false;
    const today = parseDateOnly(getTodayString());
    const diff = date.getTime() - today.getTime();
    return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000;
  }

  function isDateOverdue(dateStr) {
    return !!dateStr && dateStr < getTodayString();
  }

  function isWaitingContract(contract) {
    const columnLabel = getContractColumnLabel(contract.columnId).toLowerCase();
    const text = [contract.statusNote, contract.nextAction, contract.notes].join(' ').toLowerCase();
    return columnLabel.includes('waiting') || /\b(waiting|blocked|pending|signature|response)\b/.test(text);
  }

  function contractMatchesSavedView(contract, view) {
    const filters = view.filters || {};
    const archivedMode = filters.archived || 'active';
    if (archivedMode === 'active' && contract.archived) return false;
    if (archivedMode === 'archived' && !contract.archived) return false;
    if (filters.renewalWithinDays && !isDateWithinDays(contract.renewalDate, Number(filters.renewalWithinDays))) return false;
    if (filters.waiting && !isWaitingContract(contract)) return false;
    if (filters.noFiles && (contract.files || []).length) return false;
    if (filters.tag && !(contract.tags || []).includes(filters.tag)) return false;
    if (filters.owner === 'preferred') {
      const preferred = getPreferredOwner();
      if (preferred && contract.owner !== preferred) return false;
    } else if (filters.owner && contract.owner !== filters.owner) {
      return false;
    }
    if (filters.risk && contract.riskLevel !== filters.risk) return false;
    if (filters.search && !getContractSearchValues(contract).includes(String(filters.search).toLowerCase())) return false;
    return true;
  }

  function getFilteredContracts() {
    const activeView = getActiveSavedView();
    return ContractsState.contracts.filter(contract => {
      if (!contractMatchesSavedView(contract, activeView)) return false;
      if (ContractsState.searchQuery) {
        const haystack = getContractSearchValues(contract);
        if (!haystack.includes(ContractsState.searchQuery.toLowerCase())) return false;
      }
      if (ContractsState.filterTag && !(contract.tags || []).includes(ContractsState.filterTag)) return false;
      if (ContractsState.filterOwner && (contract.owner || '') !== ContractsState.filterOwner) return false;
      if (ContractsState.filterRisk && (contract.riskLevel || '') !== ContractsState.filterRisk) return false;
      return true;
    });
  }

  function sortContracts(contracts, sortMode) {
    const mode = sortMode || getActiveSavedView().sort || 'board';
    return contracts.slice().sort((a, b) => {
      if (mode === 'updated') {
        return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
      }
      if (mode === 'renewal') {
        const aDate = a.renewalDate ? parseDateOnly(a.renewalDate).getTime() : Number.POSITIVE_INFINITY;
        const bDate = b.renewalDate ? parseDateOnly(b.renewalDate).getTime() : Number.POSITIVE_INFINITY;
        if (aDate !== bDate) return aDate - bDate;
      }
      if ((a.sortOrder || 0) !== (b.sortOrder || 0)) return (a.sortOrder || 0) - (b.sortOrder || 0);
      const updatedDiff = new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
      if (updatedDiff) return updatedDiff;
      return (a.title || '').localeCompare(b.title || '');
    });
  }

  function getFilteredColumnContracts(columnId) {
    const filtered = getFilteredContracts();
    if (columnId === CONTRACT_ARCHIVED_COLUMN_ID) {
      return sortContracts(filtered.filter(contract => contract.archived));
    }
    return sortContracts(filtered.filter(contract => !contract.archived && contract.columnId === columnId));
  }

  function getRenewalWindowCount(days) {
    return ContractsState.contracts.filter(contract => !contract.archived && isDateWithinDays(contract.renewalDate, days)).length;
  }

  function getMissingMetadataContracts() {
    return ContractsState.contracts.filter(contract => {
      if (contract.archived) return false;
      return !contract.title || !contract.counterparty || !contract.owner || !contract.columnId || !(contract.files || []).length;
    });
  }

  function getContractsStats() {
    const active = ContractsState.contracts.filter(contract => !contract.archived);
    const fileCount = ContractsState.contracts.reduce((total, contract) => total + (contract.files || []).length, 0);
    const blocked = active.filter(isWaitingContract).length;
    const overdueActions = active.filter(contract => isDateOverdue(contract.nextActionDate) || isDateOverdue(contract.reviewDeadline)).length;
    return {
      active: active.length,
      renewalsSoon: getRenewalWindowCount(30),
      fileCount,
      blocked,
      overdueActions,
      missingMetadata: getMissingMetadataContracts().length
    };
  }

  function isValidContractUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  function getContractFileHealth(file, files) {
    const issues = [];
    if (!file.url || !isValidContractUrl(file.url)) issues.push('Invalid URL');
    const duplicates = (files || []).filter(candidate => candidate.id !== file.id && candidate.url && candidate.url === file.url);
    if (duplicates.length) issues.push('Duplicate URL');
    if (!file.type) issues.push('No type');
    return issues;
  }

  function getDuplicateContractMatch(draft) {
    if (!draft || !draft.title || !draft.counterparty) return null;
    const title = draft.title.trim().toLowerCase();
    const counterparty = draft.counterparty.trim().toLowerCase();
    const renewal = draft.renewalDate || '';
    return ContractsState.contracts.find(contract => {
      if (contract.id === ContractsState.activeContractId) return false;
      return (contract.title || '').trim().toLowerCase() === title &&
        (contract.counterparty || '').trim().toLowerCase() === counterparty &&
        (contract.renewalDate || '') === renewal;
    }) || null;
  }

  function escapeAttr(value) {
    return escapeHtml(String(value || '')).replace(/"/g, '&quot;');
  }

  function renderOptions(values, selected, placeholder, valueMapper) {
    const mapper = valueMapper || (value => ({ value, label: value }));
    return (placeholder ? '<option value="">' + escapeHtml(placeholder) + '</option>' : '') +
      values.map(item => {
        const option = mapper(item);
        return '<option value="' + escapeAttr(option.value) + '"' + (String(option.value) === String(selected || '') ? ' selected' : '') + '>' +
          escapeHtml(option.label) +
        '</option>';
      }).join('');
  }

  function renderContractsHeroStats() {
    const stats = getContractsStats();
    const activeEl = document.getElementById('contracts-stat-active');
    const renewalsEl = document.getElementById('contracts-stat-renewals');
    const filesEl = document.getElementById('contracts-stat-files');
    if (activeEl) activeEl.textContent = stats.active;
    if (renewalsEl) renewalsEl.textContent = stats.renewalsSoon;
    if (filesEl) filesEl.textContent = stats.fileCount;
  }

  function getStageAgeDays(contract) {
    const moved = (contract.activity || []).find(entry => entry.type === 'moved' || entry.type === 'created' || entry.type === 'restored');
    const baseline = moved ? moved.at : (contract.updatedAt || contract.createdAt);
    if (!baseline) return null;
    const age = Date.now() - new Date(baseline).getTime();
    if (Number.isNaN(age)) return null;
    return Math.max(0, Math.round(age / (24 * 60 * 60 * 1000)));
  }

  function renderContractsAnalytics() {
    const el = document.getElementById('contracts-analytics');
    if (!el) return;
    const stats = getContractsStats();
    const active = ContractsState.contracts.filter(contract => !contract.archived);
    const ages = active.map(getStageAgeDays).filter(age => typeof age === 'number');
    const avgAge = ages.length ? Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length) : 0;
    const nextRenewal = active
      .filter(contract => contract.renewalDate)
      .sort((a, b) => a.renewalDate.localeCompare(b.renewalDate))[0];

    el.innerHTML =
      '<article class="contracts-analytics-card">' +
        '<span class="contracts-analytics-label">Blocked / waiting</span>' +
        '<strong>' + stats.blocked + '</strong>' +
        '<span>Need outside input or signatures</span>' +
      '</article>' +
      '<article class="contracts-analytics-card ' + (stats.overdueActions ? 'warning' : '') + '">' +
        '<span class="contracts-analytics-label">Overdue actions</span>' +
        '<strong>' + stats.overdueActions + '</strong>' +
        '<span>Next actions or reviews past due</span>' +
      '</article>' +
      '<article class="contracts-analytics-card">' +
        '<span class="contracts-analytics-label">Avg stage age</span>' +
        '<strong>' + avgAge + 'd</strong>' +
        '<span>Estimated time in current stage</span>' +
      '</article>' +
      '<article class="contracts-analytics-card ' + (stats.missingMetadata ? 'warning' : '') + '">' +
        '<span class="contracts-analytics-label">Missing metadata</span>' +
        '<strong>' + stats.missingMetadata + '</strong>' +
        '<span>Missing core fields or file links</span>' +
      '</article>' +
      '<article class="contracts-analytics-card">' +
        '<span class="contracts-analytics-label">Next renewal</span>' +
        '<strong>' + (nextRenewal ? escapeHtml(formatCompactDate(nextRenewal.renewalDate)) : 'None') + '</strong>' +
        '<span>' + (nextRenewal ? escapeHtml(nextRenewal.title) : 'No renewal dates set') + '</span>' +
      '</article>';
  }

  function renderContractsFilters() {
    const viewSelect = document.getElementById('contract-saved-view');
    const tagSelect = document.getElementById('contract-filter-tag');
    const ownerSelect = document.getElementById('contract-filter-owner');
    const riskSelect = document.getElementById('contract-filter-risk');
    const densitySelect = document.getElementById('contract-density');
    const preferredOwner = document.getElementById('contract-my-owner');
    const settings = getNormalizedContractSettings();

    if (viewSelect) {
      const views = getSavedContractViews();
      if (!views.some(view => view.id === ContractsState.activeView) && ContractsState.viewsLoaded) {
        ContractsState.activeView = (views[0] && views[0].id) || 'all';
      }
      viewSelect.innerHTML = views.map(view => {
        return '<option value="' + escapeAttr(view.id) + '"' + (view.id === ContractsState.activeView ? ' selected' : '') + '>' +
          escapeHtml(view.label) +
        '</option>';
      }).join('');
    }

    if (tagSelect) {
      tagSelect.innerHTML = '<option value="">All tags</option>' + settings.tags.map(tag => {
        return '<option value="' + escapeAttr(tag.id) + '"' + (tag.id === ContractsState.filterTag ? ' selected' : '') + '>' +
          escapeHtml(tag.label) +
        '</option>';
      }).join('');
    }

    if (ownerSelect) {
      ownerSelect.innerHTML = renderOptions(getUniqueContractValues('owner', 'owners'), ContractsState.filterOwner, 'All owners');
    }

    if (riskSelect) {
      riskSelect.innerHTML = '<option value="">All risk levels</option>' + settings.riskLevels.map(level => {
        return '<option value="' + escapeAttr(level.id) + '"' + (level.id === ContractsState.filterRisk ? ' selected' : '') + '>' +
          escapeHtml(level.label) +
        '</option>';
      }).join('');
    }

    if (densitySelect) densitySelect.value = ContractsState.densityMode;
    if (preferredOwner) preferredOwner.value = ContractsState.preferredOwner || '';
  }

  function renderTagChips(contract) {
    if (!(contract.tags || []).length) return '';
    return contract.tags.map(tagId => {
      const tag = getContractDisplayTag(tagId);
      return '<span class="contract-tag-chip" style="--tag-color:' + escapeAttr(tag.color) + '">' + escapeHtml(tag.label) + '</span>';
    }).join('');
  }

  function renderMoveSelect(contract) {
    const columns = getContractColumns();
    return '<label class="contract-card-move" aria-label="Move contract">' +
      '<span>Move</span>' +
      '<select data-contract-move-select="' + contract.id + '">' +
        columns.map(column => {
          const selected = (contract.archived ? CONTRACT_ARCHIVED_COLUMN_ID : contract.columnId) === column.id;
          return '<option value="' + escapeAttr(column.id) + '"' + (selected ? ' selected' : '') + '>' + escapeHtml(column.label) + '</option>';
        }).join('') +
      '</select>' +
    '</label>';
  }

  function renderCardFilePreview(contract) {
    const files = contract.files || [];
    if (!files.length) {
      return '<div class="contract-card-files muted">No linked files yet</div>';
    }

    const density = ContractsState.densityMode;
    const limit = density === 'files' ? 4 : 2;
    const fileItems = files.slice(0, limit).map(file => {
      const health = getContractFileHealth(file, files);
      return '<div class="contract-card-file">' +
        '<span>' + escapeHtml(file.isPrimary ? 'Primary: ' : '') + escapeHtml(file.label) + '</span>' +
        (health.length ? '<span class="contract-file-health-dot" title="' + escapeAttr(health.join(', ')) + '"></span>' : '') +
      '</div>';
    }).join('');

    return '<div class="contract-card-files">' +
      fileItems +
      (files.length > limit ? '<div class="contract-card-file more">+' + (files.length - limit) + ' more files</div>' : '') +
    '</div>';
  }

  function renderContractCard(contract) {
    const renewalSoon = isDateWithinDays(contract.renewalDate, 30);
    const risk = getRiskLevel(contract.riskLevel);
    const density = ContractsState.densityMode;
    const status = contract.statusNote || contract.nextAction || '';
    const updatedLabel = contract.updatedAt ? 'Updated ' + formatRelativeTime(contract.updatedAt) : 'New';
    const nextActionChip = contract.nextActionDate
      ? '<span class="contract-chip ' + (isDateOverdue(contract.nextActionDate) ? 'danger' : '') + '">Next: ' + escapeHtml(formatCompactDate(contract.nextActionDate)) + '</span>'
      : '';
    const renewalChip = contract.renewalDate
      ? '<span class="contract-chip ' + (renewalSoon ? 'renewal-soon' : '') + '">Renewal ' + escapeHtml(formatCompactDate(contract.renewalDate)) + '</span>'
      : '';
    const riskChip = risk
      ? '<span class="contract-chip risk" style="--risk-color:' + escapeAttr(risk.color) + '">' + escapeHtml(risk.label) + ' risk</span>'
      : '';
    const archivedChip = contract.archived ? '<span class="contract-chip archived">Archived</span>' : '';
    const departmentChip = contract.department && density !== 'compact'
      ? '<span class="contract-chip">' + escapeHtml(contract.department) + '</span>'
      : '';

    return '<article class="contract-card contract-density-' + escapeAttr(density) + '" data-contract-id="' + contract.id + '" draggable="true" tabindex="0" role="button" aria-label="Open contract ' + escapeAttr(contract.title) + '">' +
      '<div class="contract-card-topline">' +
        '<div>' +
          '<div class="contract-card-title">' + escapeHtml(contract.title || 'Untitled contract') + '</div>' +
          '<div class="contract-card-subtitle">' + escapeHtml(contract.counterparty || 'No counterparty') + '</div>' +
        '</div>' +
        '<span class="contract-card-handle" title="Drag to move">::</span>' +
      '</div>' +
      '<div class="contract-card-meta">' + riskChip + renewalChip + nextActionChip + departmentChip + archivedChip + renderTagChips(contract) + '</div>' +
      (status && density !== 'compact' ? '<div class="contract-card-status">' + escapeHtml(status) + '</div>' : '') +
      (density !== 'compact' ? renderCardFilePreview(contract) : '') +
      '<div class="contract-card-footer">' +
        '<span class="contract-card-owner">' + escapeHtml(contract.owner || 'No owner') + ' · ' + escapeHtml(updatedLabel) + '</span>' +
        '<span class="contract-card-open">Open</span>' +
      '</div>' +
      renderMoveSelect(contract) +
    '</article>';
  }

  function renderContractsBoard() {
    const board = document.getElementById('contracts-board');
    const empty = document.getElementById('contracts-empty-state');
    if (!board || !empty) return;

    const columns = getContractColumns();
    const visibleCount = columns.reduce((total, column) => total + getFilteredColumnContracts(column.id).length, 0);
    board.className = 'contracts-board contracts-density-' + ContractsState.densityMode;

    if (!visibleCount) {
      board.innerHTML = columns.map(column => renderContractsColumn(column, [])).join('');
      empty.hidden = false;
      bindContractBoardDragAndDrop();
      return;
    }

    empty.hidden = true;
    board.innerHTML = columns.map(column => renderContractsColumn(column, getFilteredColumnContracts(column.id))).join('');
    bindContractBoardDragAndDrop();
  }

  function renderContractsColumn(column, contracts) {
    const isArchived = column.id === CONTRACT_ARCHIVED_COLUMN_ID;
    const emptyText = isArchived
      ? 'Archived agreements stay out of the active workflow but remain easy to restore.'
      : 'Drag contracts here or use the move control on each card.';
    const cards = contracts.length
      ? contracts.map(renderContractCard).join('')
      : '<div class="contracts-column-empty">' + escapeHtml(emptyText) + '</div>';

    return '<section class="contracts-column" data-column-id="' + escapeAttr(column.id) + '">' +
      '<div class="contracts-column-header">' +
        '<div class="contracts-column-kicker">' +
          '<span><span class="contracts-column-dot" style="background:' + escapeAttr(column.color) + '"></span> Workflow</span>' +
          (!isArchived ? '<button class="contracts-inline-icon-btn" type="button" data-add-column-contract="' + escapeAttr(column.id) + '" aria-label="Add contract to ' + escapeAttr(column.label) + '">+</button>' : '') +
        '</div>' +
        '<div class="contracts-column-title-row">' +
          '<div class="contracts-column-title">' + escapeHtml(column.label) + '</div>' +
          '<div class="contracts-column-count">' + contracts.length + '</div>' +
        '</div>' +
        '<div class="contracts-column-subtitle">' + (isArchived ? 'Out of active circulation' : 'Move by drag/drop or card controls') + '</div>' +
      '</div>' +
      '<div class="contracts-column-body" data-column-drop="' + escapeAttr(column.id) + '">' + cards + '</div>' +
    '</section>';
  }

  function renderPanelInput(id, label, value, type, options) {
    const config = options || {};
    const required = config.required ? '<span class="contracts-required">*</span>' : '';
    const listAttr = config.list ? ' list="' + escapeAttr(config.list) + '"' : '';
    const placeholder = config.placeholder ? ' placeholder="' + escapeAttr(config.placeholder) + '"' : '';
    return '<label class="contracts-panel-field' + (config.full ? ' full' : '') + '">' +
      '<span class="contracts-panel-label">' + escapeHtml(label) + required + '</span>' +
      '<input id="' + escapeAttr(id) + '" class="contracts-panel-input" type="' + escapeAttr(type || 'text') + '" value="' + escapeAttr(value || '') + '"' + listAttr + placeholder + '>' +
    '</label>';
  }

  function renderPanelSelect(id, label, value, items, options) {
    const config = options || {};
    const required = config.required ? '<span class="contracts-required">*</span>' : '';
    const placeholder = config.placeholder || 'Choose';
    return '<label class="contracts-panel-field' + (config.full ? ' full' : '') + '">' +
      '<span class="contracts-panel-label">' + escapeHtml(label) + required + '</span>' +
      '<select id="' + escapeAttr(id) + '" class="contracts-panel-select">' +
        renderOptions(items, value, placeholder, config.mapper) +
      '</select>' +
    '</label>';
  }

  function renderDatalist(id, values) {
    return '<datalist id="' + escapeAttr(id) + '">' +
      values.map(value => '<option value="' + escapeAttr(value) + '"></option>').join('') +
    '</datalist>';
  }

  function renderDraftTags(draft) {
    const tags = getLibraryItems('tags');
    if (!tags.length) {
      return '<div class="contracts-empty-inline">No tags yet. Add global tags from Board settings.</div>';
    }
    return '<div class="contracts-tag-grid">' + tags.map(tag => {
      const active = (draft.tags || []).includes(tag.id);
      return '<button class="contract-tag-toggle' + (active ? ' active' : '') + '" type="button" data-tag-toggle="' + escapeAttr(tag.id) + '" style="--tag-color:' + escapeAttr(tag.color) + '">' +
        escapeHtml(tag.label) +
      '</button>';
    }).join('') + '</div>';
  }

  function renderDuplicateWarning(draft) {
    const duplicate = getDuplicateContractMatch(draft);
    if (!duplicate) return '';
    return '<div class="contracts-warning">' +
      '<strong>Possible duplicate:</strong> ' + escapeHtml(duplicate.title) + ' with ' + escapeHtml(duplicate.counterparty) +
      ' already exists. You can still save if this is intentional.' +
    '</div>';
  }

  function renderFileHealthBadges(file, files) {
    const issues = getContractFileHealth(file, files);
    if (!issues.length) return '<span class="contract-file-health ok">Healthy link</span>';
    return issues.map(issue => '<span class="contract-file-health warning">' + escapeHtml(issue) + '</span>').join('');
  }

  function renderContractFileItem(file, files) {
    const type = file.type ? getFileTypeLabel(file.type) : 'No type';
    const meta = [
      type,
      file.version ? 'v' + file.version : '',
      file.owner ? 'Owner: ' + file.owner : '',
      file.dateUpdated ? 'Updated ' + formatRelativeTime(file.dateUpdated) : ''
    ].filter(Boolean).join(' · ');
    return '<div class="contracts-file-item">' +
      '<div>' +
        '<div class="contracts-file-title">' + (file.isPrimary ? '<span class="contract-primary-dot">Primary</span> ' : '') + escapeHtml(file.label) + '</div>' +
        '<div class="contracts-file-meta">' + escapeHtml(meta || 'Linked document') + '</div>' +
        (file.note ? '<div class="contracts-file-note">' + escapeHtml(file.note) + '</div>' : '') +
        '<div class="contracts-file-health-row">' + renderFileHealthBadges(file, files) + '</div>' +
      '</div>' +
      '<div class="contracts-file-actions">' +
        '<a class="contracts-inline-link" href="' + escapeAttr(file.url) + '" target="_blank" rel="noopener">Open</a>' +
        '<button class="contracts-inline-icon-btn" type="button" data-file-copy="' + escapeAttr(file.id) + '">Copy</button>' +
        '<button class="contracts-inline-icon-btn" type="button" data-file-edit="' + escapeAttr(file.id) + '">Edit</button>' +
        '<button class="contracts-inline-icon-btn" type="button" data-file-remove="' + escapeAttr(file.id) + '">Remove</button>' +
      '</div>' +
    '</div>';
  }

  function renderFileSections(draft) {
    const files = draft.files || [];
    if (!files.length) {
      return '<div class="contracts-empty-inline">No file links yet. Add the agreement, amendments, schedules, or reference links below.</div>';
    }
    return FILE_GROUPS.map(group => {
      const groupFiles = files.filter(file => file.group === group.id || (group.id === 'reference' && !file.group));
      if (!groupFiles.length) return '';
      return '<div class="contracts-file-group">' +
        '<div class="contracts-file-group-title">' + escapeHtml(group.label) + '</div>' +
        '<div class="contracts-file-list">' + groupFiles.map(file => renderContractFileItem(file, files)).join('') + '</div>' +
      '</div>';
    }).join('');
  }

  function renderFileDraftForm() {
    const draft = ContractsState.fileDraft || createEmptyFileDraft();
    const typeValues = getLibraryItems('fileTypes').map(type => type.label);
    return '<div class="contracts-file-form">' +
      renderPanelInput('contract-file-label', 'Label', draft.label, 'text', { placeholder: 'Master agreement' }) +
      renderPanelSelect('contract-file-group', 'Section', draft.group, FILE_GROUPS, {
        mapper: group => ({ value: group.id, label: group.label })
      }) +
      renderPanelInput('contract-file-type', 'Type', draft.type, 'text', { list: 'contract-file-type-options', placeholder: 'Agreement' }) +
      renderPanelInput('contract-file-version', 'Version', draft.version, 'text', { placeholder: '1.0' }) +
      renderPanelInput('contract-file-owner', 'File owner', draft.owner, 'text', { list: 'contract-owner-options', placeholder: 'Jason' }) +
      renderPanelInput('contract-file-url', 'URL', draft.url, 'url', { placeholder: 'https://...' }) +
      '<label class="contracts-panel-field full">' +
        '<span class="contracts-panel-label">Note</span>' +
        '<textarea id="contract-file-note" class="contracts-panel-textarea status" placeholder="Optional file context">' + escapeHtml(draft.note || '') + '</textarea>' +
      '</label>' +
      '<label class="contracts-checkline full">' +
        '<input id="contract-file-primary" type="checkbox"' + (draft.isPrimary ? ' checked' : '') + '>' +
        '<span>Mark as the primary agreement</span>' +
      '</label>' +
      '<div class="contracts-row-actions full">' +
        '<button class="btn btn-primary" id="contract-file-save" type="button">' + (ContractsState.editingFileId ? 'Update file link' : 'Add file link') + '</button>' +
        '<button class="btn btn-secondary" id="contract-file-cancel" type="button">Clear</button>' +
      '</div>' +
      renderDatalist('contract-file-type-options', typeValues) +
    '</div>';
  }

  function renderActivityLog(draft) {
    const activity = draft.activity || [];
    if (!activity.length) {
      return '<div class="contracts-empty-inline">Major contract events will show up here.</div>';
    }
    return '<div class="contracts-activity-list">' + activity.slice(0, 8).map(entry => {
      return '<div class="contracts-activity-item">' +
        '<span class="contracts-activity-dot"></span>' +
        '<div>' +
          '<div class="contracts-activity-label">' + escapeHtml(entry.label) + '</div>' +
          '<div class="contracts-activity-time">' + escapeHtml(formatRelativeTime(entry.at)) + '</div>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function renderContractsPanel() {
    const panel = document.getElementById('contracts-panel');
    const scrim = document.getElementById('contracts-panel-scrim');
    const content = document.getElementById('contracts-panel-content');
    if (!panel || !scrim || !content) return;

    if (!ContractsState.panelOpen || !ContractsState.draft) {
      panel.hidden = true;
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
      scrim.hidden = true;
      content.innerHTML = '';
      return;
    }

    const draft = ContractsState.draft;
    const columns = getContractColumns();
    const settings = getNormalizedContractSettings();
    const ownerValues = getUniqueContractValues('owner', 'owners');
    const departmentValues = getUniqueContractValues('department', 'departments');
    const title = draft.title || 'New contract';
    const archiveLabel = draft.archived ? 'Restore to board' : 'Archive';

    panel.hidden = false;
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    scrim.hidden = false;

    content.innerHTML =
      '<div class="contracts-panel-head">' +
        '<div>' +
          '<div class="contracts-panel-title">' + escapeHtml(title) + '</div>' +
          '<div class="contracts-panel-subtitle">' + (ContractsState.activeContractId ? 'Contract detail and file links' : 'Create a contract card') + '</div>' +
        '</div>' +
        '<button class="contracts-panel-close" id="contracts-panel-close" type="button" aria-label="Close contract panel">Close</button>' +
      '</div>' +
      renderDuplicateWarning(draft) +
      '<div class="contracts-panel-quick-actions">' +
        '<button class="btn btn-secondary" id="contract-copy-summary" type="button">Copy summary</button>' +
        '<button class="btn btn-secondary" id="contract-export-markdown" type="button">Markdown export</button>' +
        '<button class="btn btn-secondary" id="contract-create-next-task" type="button">Task from next action</button>' +
        '<button class="btn btn-secondary" id="contract-create-renewal-task" type="button">Task from renewal</button>' +
      '</div>' +
      '<section class="contracts-panel-section-card">' +
        '<div class="contracts-panel-section-title">Core info</div>' +
        '<div class="contracts-panel-grid">' +
          renderPanelInput('contract-title', 'Title', draft.title, 'text', { required: true, full: true, placeholder: 'MSA - False Creek Imaging' }) +
          renderPanelInput('contract-counterparty', 'Counterparty', draft.counterparty, 'text', { required: true, placeholder: 'False Creek Imaging' }) +
          renderPanelInput('contract-owner', 'Owner', draft.owner, 'text', { required: true, list: 'contract-owner-options', placeholder: 'Jason' }) +
          renderPanelSelect('contract-column', 'Workflow column', draft.columnId, columns, {
            required: true,
            mapper: column => ({ value: column.id, label: column.label })
          }) +
          renderPanelInput('contract-department', 'Department', draft.department, 'text', { list: 'contract-department-options', placeholder: 'VCHRI' }) +
          renderPanelSelect('contract-risk', 'Risk level', draft.riskLevel, settings.riskLevels, {
            placeholder: 'No risk level',
            mapper: level => ({ value: level.id, label: level.label })
          }) +
          renderPanelInput('contract-value', 'Contract value', draft.contractValue, 'text', { placeholder: '$25,000' }) +
          renderPanelInput('contract-contact-name', 'Contact name', draft.contactName, 'text', { placeholder: 'Contract contact' }) +
          renderPanelInput('contract-contact-email', 'Contact email', draft.contactEmail, 'email', { placeholder: 'name@example.com', full: true }) +
        '</div>' +
      '</section>' +
      '<section class="contracts-panel-section-card">' +
        '<div class="contracts-panel-section-title">Dates and next action</div>' +
        '<div class="contracts-panel-grid">' +
          renderPanelInput('contract-effective-date', 'Effective date', draft.effectiveDate, 'date') +
          renderPanelInput('contract-signature-date', 'Signature date', draft.signatureDate, 'date') +
          renderPanelInput('contract-renewal-date', 'Renewal date', draft.renewalDate, 'date') +
          renderPanelInput('contract-review-deadline', 'Review deadline', draft.reviewDeadline, 'date') +
          renderPanelInput('contract-next-action-date', 'Next action date', draft.nextActionDate, 'date') +
          renderPanelInput('contract-next-action', 'Next action', draft.nextAction, 'text', { placeholder: 'Send final signature page', full: true }) +
        '</div>' +
      '</section>' +
      '<section class="contracts-panel-section-card">' +
        '<div class="contracts-panel-section-title">Tags</div>' +
        renderDraftTags(draft) +
      '</section>' +
      '<section class="contracts-panel-section-card">' +
        '<div class="contracts-panel-section-title">Status note</div>' +
        '<textarea id="contract-status-note" class="contracts-panel-textarea status" placeholder="Where things stand right now...">' + escapeHtml(draft.statusNote || '') + '</textarea>' +
      '</section>' +
      '<section class="contracts-panel-section-card">' +
        '<div class="contracts-panel-section-title">Files</div>' +
        renderFileSections(draft) +
        renderFileDraftForm() +
      '</section>' +
      '<section class="contracts-panel-section-card">' +
        '<div class="contracts-panel-section-title">Notes</div>' +
        '<textarea id="contract-notes" class="contracts-panel-textarea" placeholder="Longer context, decisions, or negotiation notes...">' + escapeHtml(draft.notes || '') + '</textarea>' +
      '</section>' +
      '<section class="contracts-panel-section-card">' +
        '<div class="contracts-panel-section-title">Activity</div>' +
        renderActivityLog(draft) +
      '</section>' +
      '<div class="contracts-panel-actions">' +
        '<div class="contracts-panel-actions-side">' +
          '<button class="btn btn-secondary" id="contract-archive-toggle" type="button">' + archiveLabel + '</button>' +
          '<button class="btn btn-secondary danger" id="contract-delete" type="button">Delete</button>' +
        '</div>' +
        '<div class="contracts-panel-actions-main">' +
          '<button class="btn btn-secondary" id="contract-cancel" type="button">Cancel</button>' +
          '<button class="btn btn-primary" id="contract-save" type="button">Save contract</button>' +
        '</div>' +
      '</div>' +
      renderDatalist('contract-owner-options', ownerValues) +
      renderDatalist('contract-department-options', departmentValues);
  }

  function renderSettingsRows(items, type, options) {
    const config = options || {};
    return items.map((item, index) => {
      const locked = config.lockedId && item.id === config.lockedId;
      return '<div class="contracts-settings-row' + (locked ? ' locked' : '') + '" data-settings-row="' + escapeAttr(type) + '" data-id="' + escapeAttr(item.id) + '">' +
        '<input class="contracts-settings-input" data-settings-label="' + escapeAttr(type) + '" value="' + escapeAttr(item.label) + '"' + (locked && config.lockLabel ? ' readonly' : '') + '>' +
        '<input class="contracts-settings-input" data-settings-color="' + escapeAttr(type) + '" type="color" value="' + escapeAttr(item.color || '#6366f1') + '">' +
        '<div class="contracts-row-actions">' +
          (type === 'columns' && !locked ? '<button class="contracts-inline-icon-btn" type="button" data-column-move="up" data-column-id="' + escapeAttr(item.id) + '">Up</button><button class="contracts-inline-icon-btn" type="button" data-column-move="down" data-column-id="' + escapeAttr(item.id) + '">Down</button>' : '') +
          (!locked ? '<button class="contracts-inline-icon-btn" type="button" data-library-delete="' + escapeAttr(type) + '" data-id="' + escapeAttr(item.id) + '">Delete</button>' : '<span class="contracts-settings-helper">Locked</span>') +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderSettingsSection(title, helper, type, items, addLabel, options) {
    return '<section class="contracts-settings-section">' +
      '<div class="contracts-settings-section-head">' +
        '<div>' +
          '<div class="contracts-settings-section-label">' + escapeHtml(title) + '</div>' +
          '<div class="contracts-settings-helper">' + escapeHtml(helper) + '</div>' +
        '</div>' +
        '<button class="btn btn-secondary" type="button" data-library-add="' + escapeAttr(type) + '">' + escapeHtml(addLabel) + '</button>' +
      '</div>' +
      '<div class="contracts-settings-list">' + renderSettingsRows(items, type, options) + '</div>' +
    '</section>';
  }

  function renderContractsSettings() {
    const overlay = document.getElementById('contracts-settings-overlay');
    const content = document.getElementById('contracts-settings-content');
    if (!overlay || !content) return;

    if (!ContractsState.settingsOpen || !ContractsState.settingsDraft) {
      overlay.hidden = true;
      content.innerHTML = '';
      return;
    }

    const draft = normalizeContractBoardSettings(ContractsState.settingsDraft);
    overlay.hidden = false;
    content.innerHTML =
      '<div class="contracts-settings-head">' +
        '<div>' +
          '<div class="contracts-settings-title" id="contracts-settings-title">Contract board settings</div>' +
          '<div class="contracts-settings-subtitle">Customize workflow columns, tags, and reusable metadata lists.</div>' +
        '</div>' +
        '<button class="contracts-settings-close" id="contracts-settings-close" type="button" aria-label="Close settings">Close</button>' +
      '</div>' +
      '<div class="contracts-settings-grid wide">' +
        renderSettingsSection('Workflow columns', 'Archived is locked so restores and filters stay reliable.', 'columns', draft.columns, '+ Column', {
          lockedId: CONTRACT_ARCHIVED_COLUMN_ID,
          lockLabel: true
        }) +
        renderSettingsSection('Tags', 'Colored metadata labels that can be assigned to any contract.', 'tags', draft.tags, '+ Tag') +
        renderSettingsSection('Owners', 'Reusable owner suggestions for filtering and task creation.', 'owners', draft.owners, '+ Owner') +
        renderSettingsSection('Departments', 'Reusable department suggestions for reporting.', 'departments', draft.departments, '+ Department') +
        renderSettingsSection('Risk levels', 'Control risk labels and colors shown on cards.', 'riskLevels', draft.riskLevels, '+ Risk') +
        renderSettingsSection('File types', 'Reusable file type suggestions for linked documents.', 'fileTypes', draft.fileTypes, '+ File type') +
      '</div>' +
      '<div class="contracts-settings-actions">' +
        '<button class="btn btn-secondary" id="contracts-settings-cancel" type="button">Cancel</button>' +
        '<button class="btn btn-primary" id="contracts-settings-save" type="button">Save settings</button>' +
      '</div>';
  }

  function syncDraftFromPanel() {
    if (!ContractsState.panelOpen || !ContractsState.draft) return;
    const getValue = id => {
      const el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };
    const getNullable = id => getValue(id) || null;

    ContractsState.draft = normalizeContract({
      ...ContractsState.draft,
      title: getValue('contract-title') || ContractsState.draft.title,
      counterparty: getValue('contract-counterparty'),
      owner: getValue('contract-owner'),
      columnId: getValue('contract-column') || ContractsState.draft.columnId,
      contractValue: getValue('contract-value'),
      department: getValue('contract-department'),
      contactName: getValue('contract-contact-name'),
      contactEmail: getValue('contract-contact-email'),
      riskLevel: getValue('contract-risk'),
      reviewDeadline: getNullable('contract-review-deadline'),
      signatureDate: getNullable('contract-signature-date'),
      nextAction: getValue('contract-next-action'),
      nextActionDate: getNullable('contract-next-action-date'),
      effectiveDate: getNullable('contract-effective-date'),
      renewalDate: getNullable('contract-renewal-date'),
      statusNote: getValue('contract-status-note'),
      notes: getValue('contract-notes')
    });

    ContractsState.fileDraft = createEmptyFileDraft({
      ...ContractsState.fileDraft,
      label: getValue('contract-file-label'),
      url: getValue('contract-file-url'),
      type: getValue('contract-file-type'),
      version: getValue('contract-file-version'),
      owner: getValue('contract-file-owner'),
      group: getValue('contract-file-group') || 'reference',
      note: getValue('contract-file-note'),
      isPrimary: !!document.getElementById('contract-file-primary')?.checked
    });
  }

  function syncSettingsDraftFromDom() {
    if (!ContractsState.settingsOpen || !ContractsState.settingsDraft) return;
    const draft = normalizeContractBoardSettings(ContractsState.settingsDraft);
    const next = {
      columns: [],
      tags: [],
      owners: [],
      departments: [],
      riskLevels: [],
      fileTypes: []
    };
    Object.keys(next).forEach(type => {
      document.querySelectorAll('[data-settings-row="' + type + '"]').forEach((row, index) => {
        const id = row.dataset.id;
        const labelInput = row.querySelector('[data-settings-label]');
        const colorInput = row.querySelector('[data-settings-color]');
        next[type].push({
          id,
          label: labelInput ? labelInput.value.trim() : '',
          color: colorInput ? colorInput.value : '#6366f1',
          order: index
        });
      });
    });
    ContractsState.settingsDraft = normalizeContractBoardSettings({
      ...draft,
      ...next
    });
  }

  function openContractPanel(contractOrSeed) {
    rememberFocus();
    const contract = contractOrSeed && contractOrSeed.id
      ? cloneContractSnapshot(contractOrSeed)
      : contractOrSeed;
    ContractsState.panelOpen = true;
    ContractsState.activeContractId = contract && contract.id ? contract.id : null;
    ContractsState.draft = buildContractDraft(contract);
    ContractsState.fileDraft = createEmptyFileDraft();
    ContractsState.editingFileId = null;
    renderContracts();
    requestAnimationFrame(() => document.getElementById('contract-title')?.focus());
  }

  function closeContractPanel() {
    ContractsState.panelOpen = false;
    ContractsState.activeContractId = null;
    ContractsState.draft = null;
    ContractsState.fileDraft = null;
    ContractsState.editingFileId = null;
    renderContracts();
    restoreFocus();
  }

  function openSettingsModal() {
    rememberFocus();
    ContractsState.settingsOpen = true;
    ContractsState.settingsDraft = cloneContractSnapshot(getNormalizedContractSettings());
    renderContracts();
  }

  function closeSettingsModal() {
    ContractsState.settingsOpen = false;
    ContractsState.settingsDraft = null;
    renderContracts();
    restoreFocus();
  }

  function toggleDraftTag(tagId) {
    if (!ContractsState.draft) return;
    syncDraftFromPanel();
    const hasTag = (ContractsState.draft.tags || []).includes(tagId);
    ContractsState.draft.tags = hasTag
      ? ContractsState.draft.tags.filter(id => id !== tagId)
      : ContractsState.draft.tags.concat(tagId);
    renderContractsPanel();
  }

  function resetFileDraft() {
    ContractsState.fileDraft = createEmptyFileDraft();
    ContractsState.editingFileId = null;
  }

  function editFileDraft(fileId) {
    syncDraftFromPanel();
    const file = (ContractsState.draft && ContractsState.draft.files || []).find(item => item.id === fileId);
    if (!file) return;
    ContractsState.fileDraft = createEmptyFileDraft(file);
    ContractsState.editingFileId = file.id;
    renderContractsPanel();
  }

  function removeFileFromDraft(fileId) {
    if (!ContractsState.draft) return;
    syncDraftFromPanel();
    ContractsState.draft.files = (ContractsState.draft.files || []).filter(file => file.id !== fileId);
    if (ContractsState.editingFileId === fileId) resetFileDraft();
    renderContractsPanel();
  }

  function saveFileDraft() {
    syncDraftFromPanel();
    const draft = ContractsState.fileDraft || createEmptyFileDraft();
    if (!draft.label) {
      showToast('Add a label for the file link');
      return;
    }
    if (!draft.url || !isValidContractUrl(draft.url)) {
      showToast('Add a valid http or https URL for the file link');
      return;
    }
    const duplicate = (ContractsState.draft.files || []).find(file => file.id !== ContractsState.editingFileId && file.url === draft.url);
    if (duplicate) {
      showToast('That URL is already linked on this contract');
      return;
    }

    const existing = (ContractsState.draft.files || []).find(file => file.id === ContractsState.editingFileId);
    const timestamp = getCurrentTimestamp();
    const normalized = normalizeContractFile({
      id: ContractsState.editingFileId || createId('contract-file'),
      label: draft.label,
      url: draft.url,
      type: draft.type,
      version: draft.version,
      owner: draft.owner,
      group: draft.isPrimary ? 'primary' : draft.group,
      note: draft.note,
      isPrimary: draft.isPrimary,
      dateAdded: existing ? existing.dateAdded : timestamp,
      dateUpdated: timestamp
    });
    if (!normalized) {
      showToast('Could not save that file link');
      return;
    }

    let files = (ContractsState.draft.files || []).slice();
    if (normalized.isPrimary) {
      files = files.map(file => ({ ...file, isPrimary: file.id === normalized.id }));
    }
    const existingIndex = files.findIndex(file => file.id === normalized.id);
    if (existingIndex >= 0) files.splice(existingIndex, 1, normalized);
    else files.push(normalized);
    ContractsState.draft.files = files;
    resetFileDraft();
    renderContractsPanel();
    showToast(existingIndex >= 0 ? 'File link updated' : 'File link added');
  }

  async function handleSaveContract() {
    syncDraftFromPanel();
    const existing = ContractsState.activeContractId
      ? ContractsState.contracts.find(contract => contract.id === ContractsState.activeContractId)
      : null;
    const duplicate = getDuplicateContractMatch(ContractsState.draft);
    const savedId = await saveContractRecord(ContractsState.draft, existing || null);
    if (!savedId) return;
    if (duplicate) showToast('Contract saved with duplicate warning');
    closeContractPanel();
  }

  async function handleDeleteContract() {
    if (!ContractsState.activeContractId) {
      closeContractPanel();
      return;
    }
    const existing = ContractsState.contracts.find(contract => contract.id === ContractsState.activeContractId);
    if (!existing) return;
    if (!window.confirm('Delete this contract? You will have a short undo window.')) return;
    const success = await deleteContractRecordWithUndo(existing);
    if (success) closeContractPanel();
  }

  function toggleArchiveDraftDestination() {
    syncDraftFromPanel();
    if (!ContractsState.draft) return;
    if (ContractsState.draft.columnId === CONTRACT_ARCHIVED_COLUMN_ID || ContractsState.draft.archived) {
      ContractsState.draft.columnId = ContractsState.draft.previousColumnId || getDefaultContractColumnId();
      ContractsState.draft.archived = false;
      ContractsState.draft.archivedAt = null;
    } else {
      ContractsState.draft.previousColumnId = ContractsState.draft.columnId || getDefaultContractColumnId();
      ContractsState.draft.columnId = CONTRACT_ARCHIVED_COLUMN_ID;
      ContractsState.draft.archived = true;
      ContractsState.draft.archivedAt = getCurrentTimestamp();
    }
    renderContractsPanel();
  }

  function validateSettingsDraft() {
    const draft = normalizeContractBoardSettings(ContractsState.settingsDraft || getNormalizedContractSettings());
    const groups = ['columns', 'tags', 'owners', 'departments', 'riskLevels', 'fileTypes'];
    for (const group of groups) {
      if (!draft[group].every(item => item.label.trim())) {
        showToast('Every settings row needs a label');
        return null;
      }
    }
    return draft;
  }

  async function saveSettingsDraft() {
    syncSettingsDraftFromDom();
    const validated = validateSettingsDraft();
    if (!validated) return;
    const success = await saveContractBoardSettings(validated);
    if (success) closeSettingsModal();
  }

  function addLibraryItem(type) {
    syncSettingsDraftFromDom();
    const draft = normalizeContractBoardSettings(ContractsState.settingsDraft || getNormalizedContractSettings());
    const labels = {
      columns: 'New Column',
      tags: 'New Tag',
      owners: 'New Owner',
      departments: 'New Department',
      riskLevels: 'New Risk',
      fileTypes: 'New File Type'
    };
    const prefixes = {
      columns: 'contract-column',
      tags: 'contract-tag',
      owners: 'contract-owner',
      departments: 'contract-department',
      riskLevels: 'contract-risk',
      fileTypes: 'contract-file-type'
    };
    if (!draft[type]) return;
    const item = {
      id: createId(prefixes[type]),
      label: labels[type] || 'New Item',
      color: type === 'riskLevels' ? '#f59e0b' : '#6366f1',
      order: draft[type].length
    };
    if (type === 'columns') draft.columns.splice(Math.max(0, draft.columns.length - 1), 0, item);
    else draft[type].push(item);
    ContractsState.settingsDraft = draft;
    renderContractsSettings();
  }

  function moveSettingsColumn(columnId, direction) {
    syncSettingsDraftFromDom();
    const draft = normalizeContractBoardSettings(ContractsState.settingsDraft || getNormalizedContractSettings());
    const activeColumns = draft.columns.filter(column => column.id !== CONTRACT_ARCHIVED_COLUMN_ID);
    const index = activeColumns.findIndex(column => column.id === columnId);
    if (index < 0) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= activeColumns.length) return;
    const swap = activeColumns[index];
    activeColumns[index] = activeColumns[targetIndex];
    activeColumns[targetIndex] = swap;
    const archived = draft.columns.find(column => column.id === CONTRACT_ARCHIVED_COLUMN_ID);
    ContractsState.settingsDraft = normalizeContractBoardSettings({
      ...draft,
      columns: activeColumns.concat(archived ? [archived] : [])
    });
    renderContractsSettings();
  }

  function deleteLibraryItem(type, id) {
    if (type === 'columns') {
      const hasContracts = ContractsState.contracts.some(contract => !contract.archived && contract.columnId === id);
      if (hasContracts) {
        showToast('Move contracts out of that column before deleting it');
        return;
      }
      if (id === CONTRACT_ARCHIVED_COLUMN_ID) return;
    }
    if (type === 'tags') {
      const inUse = ContractsState.contracts.some(contract => (contract.tags || []).includes(id));
      if (inUse) {
        showToast('Remove that tag from contracts before deleting it');
        return;
      }
    }
    syncSettingsDraftFromDom();
    const draft = normalizeContractBoardSettings(ContractsState.settingsDraft || getNormalizedContractSettings());
    if (!draft[type]) return;
    draft[type] = draft[type].filter(item => item.id !== id);
    ContractsState.settingsDraft = draft;
    renderContractsSettings();
  }

  function clearContractDragState() {
    ContractsState.draggedContractId = null;
    document.querySelectorAll('.contract-card.dragging, .contract-card.drag-over-top, .contract-card.drag-over-bottom').forEach(card => {
      card.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
    });
    document.querySelectorAll('.contracts-column.drag-over-column').forEach(column => column.classList.remove('drag-over-column'));
  }

  function bindContractBoardDragAndDrop() {
    document.querySelectorAll('.contract-card').forEach(card => {
      const contractId = card.dataset.contractId;
      card.addEventListener('dragstart', event => {
        ContractsState.suppressCardOpen = true;
        ContractsState.draggedContractId = contractId;
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', contractId);
          if (typeof event.dataTransfer.setDragImage === 'function') {
            event.dataTransfer.setDragImage(card, 24, 24);
          }
        }
        requestAnimationFrame(() => card.classList.add('dragging'));
      });
      card.addEventListener('dragover', event => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      });
      card.addEventListener('dragenter', event => {
        if (!ContractsState.draggedContractId || ContractsState.draggedContractId === contractId) return;
        const rect = card.getBoundingClientRect();
        const before = event.clientY < rect.top + rect.height / 2;
        card.classList.toggle('drag-over-top', before);
        card.classList.toggle('drag-over-bottom', !before);
        card.closest('.contracts-column')?.classList.add('drag-over-column');
      });
      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      card.addEventListener('drop', async event => {
        event.preventDefault();
        event.stopPropagation();
        if (!ContractsState.draggedContractId || ContractsState.draggedContractId === contractId) {
          clearContractDragState();
          return;
        }
        const before = card.classList.contains('drag-over-top');
        const column = card.closest('.contracts-column');
        const targetColumnId = column ? column.dataset.columnId : getDefaultContractColumnId();
        await moveContractRecord(ContractsState.draggedContractId, targetColumnId, contractId, before ? 'before' : 'after');
        clearContractDragState();
      });
      card.addEventListener('dragend', () => {
        clearContractDragState();
        window.setTimeout(() => {
          ContractsState.suppressCardOpen = false;
        }, 80);
      });
    });

    document.querySelectorAll('[data-column-drop]').forEach(body => {
      body.addEventListener('dragover', event => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        body.closest('.contracts-column')?.classList.add('drag-over-column');
      });
      body.addEventListener('dragleave', event => {
        const column = body.closest('.contracts-column');
        if (!column) return;
        const related = event.relatedTarget;
        if (related && column.contains(related)) return;
        column.classList.remove('drag-over-column');
      });
      body.addEventListener('drop', async event => {
        event.preventDefault();
        const targetColumnId = body.dataset.columnDrop;
        if (!ContractsState.draggedContractId) {
          clearContractDragState();
          return;
        }
        await moveContractRecord(ContractsState.draggedContractId, targetColumnId, null, 'after');
        clearContractDragState();
      });
    });
  }

  function buildContractSummary(contract) {
    const files = contract.files || [];
    const lines = [
      '# ' + (contract.title || 'Untitled contract'),
      '',
      '- Counterparty: ' + (contract.counterparty || 'Not set'),
      '- Owner: ' + (contract.owner || 'Not set'),
      '- Workflow: ' + getContractColumnLabel(contract.columnId),
      '- Department: ' + (contract.department || 'Not set'),
      '- Risk: ' + ((getRiskLevel(contract.riskLevel) || {}).label || contract.riskLevel || 'Not set'),
      '- Effective: ' + (contract.effectiveDate || 'Not set'),
      '- Renewal: ' + (contract.renewalDate || 'Not set'),
      '- Next action: ' + (contract.nextAction || 'Not set'),
      '- Next action date: ' + (contract.nextActionDate || 'Not set'),
      '',
      '## Status',
      contract.statusNote || 'No status note.',
      '',
      '## Files',
      files.length ? files.map(file => '- [' + file.label + '](' + file.url + ')' + (file.type ? ' - ' + file.type : '')).join('\n') : 'No file links.',
      '',
      '## Notes',
      contract.notes || 'No notes.'
    ];
    return lines.join('\n');
  }

  async function copyContractSummary() {
    syncDraftFromPanel();
    await copyTextToClipboard(buildContractSummary(ContractsState.draft), 'Contract summary copied', 'Failed to copy contract summary');
  }

  function downloadTextFile(filename, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function exportContractMarkdown() {
    syncDraftFromPanel();
    const name = (ContractsState.draft.title || 'contract-summary').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    downloadTextFile((name || 'contract-summary') + '.md', buildContractSummary(ContractsState.draft), 'text/markdown');
    showToast('Contract summary exported');
  }

  function exportFilteredContractsCsv() {
    const contracts = sortContracts(getFilteredContracts(), getActiveSavedView().sort);
    const headers = [
      'Title', 'Counterparty', 'Owner', 'Workflow', 'Department', 'Risk', 'Value',
      'Effective date', 'Renewal date', 'Review deadline', 'Next action', 'Next action date',
      'Files', 'Tags', 'Updated'
    ];
    const rows = contracts.map(contract => [
      contract.title,
      contract.counterparty,
      contract.owner,
      getContractColumnLabel(contract.columnId),
      contract.department,
      ((getRiskLevel(contract.riskLevel) || {}).label || contract.riskLevel),
      contract.contractValue,
      contract.effectiveDate,
      contract.renewalDate,
      contract.reviewDeadline,
      contract.nextAction,
      contract.nextActionDate,
      (contract.files || []).length,
      (contract.tags || []).map(tagId => getContractDisplayTag(tagId).label).join('; '),
      contract.updatedAt
    ]);
    const csv = [headers].concat(rows).map(row => {
      return row.map(value => '"' + String(value || '').replace(/"/g, '""') + '"').join(',');
    }).join('\n');
    downloadTextFile('contracts-' + getTodayString() + '.csv', csv, 'text/csv');
    showToast('Filtered contracts exported');
  }

  function printRenewalReport() {
    const contracts = ContractsState.contracts
      .filter(contract => !contract.archived && contract.renewalDate && isDateWithinDays(contract.renewalDate, 90))
      .sort((a, b) => a.renewalDate.localeCompare(b.renewalDate));
    const html = '<!doctype html><html><head><title>Contract renewal report</title>' +
      '<style>body{font-family:system-ui,sans-serif;padding:32px;color:#111827}h1{margin:0 0 8px}table{width:100%;border-collapse:collapse;margin-top:20px}td,th{border-bottom:1px solid #e5e7eb;padding:10px;text-align:left}th{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280}</style>' +
      '</head><body><h1>Contract renewal report</h1><p>Next 90 days from ' + escapeHtml(formatCompactDate(getTodayString())) + '</p>' +
      '<table><thead><tr><th>Renewal</th><th>Title</th><th>Counterparty</th><th>Owner</th><th>Next action</th></tr></thead><tbody>' +
      contracts.map(contract => '<tr><td>' + escapeHtml(formatCompactDate(contract.renewalDate)) + '</td><td>' + escapeHtml(contract.title) + '</td><td>' + escapeHtml(contract.counterparty) + '</td><td>' + escapeHtml(contract.owner) + '</td><td>' + escapeHtml(contract.nextAction || '') + '</td></tr>').join('') +
      '</tbody></table></body></html>';
    const win = window.open('', '_blank');
    if (!win) {
      showToast('Allow popups to print the report');
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }

  async function createTaskFromContract(kind) {
    syncDraftFromPanel();
    const contract = ContractsState.draft;
    if (!ContractsState.activeContractId) {
      showToast('Save the contract before creating linked tasks');
      return;
    }

    let date = contract.nextActionDate || getTodayString();
    let text = contract.nextAction || ('Follow up: ' + contract.title);
    let reminderDate = date;
    const reminderTime = '09:00';
    if (kind === 'renewal') {
      if (!contract.renewalDate) {
        showToast('Add a renewal date first');
        return;
      }
      date = contract.renewalDate;
      reminderDate = addDays(contract.renewalDate, -7);
      if (reminderDate < getTodayString()) reminderDate = contract.renewalDate;
      text = 'Renewal review: ' + contract.title;
    }

    await requestNotificationPermissionIfNeeded();

    const taskId = await addTask({
      text,
      priority: contract.riskLevel === 'high' ? 'high' : 'medium',
      category: DEFAULT_CATEGORY_ID,
      dueTime: reminderTime,
      date,
      completed: false,
      pinned: kind !== 'renewal',
      archived: false,
      recurrence: 'none',
      recurringSourceId: null,
      notes: 'Linked contract: ' + contract.title + '\nCounterparty: ' + contract.counterparty + '\nOpen: contracts.html#contract=' + ContractsState.activeContractId,
      notesUpdatedAt: getCurrentTimestamp(),
      subtasks: [],
      reminderDate,
      reminderTime,
      reminderFired: false,
      contractId: ContractsState.activeContractId,
      contractTitle: contract.title,
      contractCounterparty: contract.counterparty
    }, {
      toastMessage: kind === 'renewal' ? 'Renewal task created' : 'Next-action task created'
    });

    if (taskId) {
      queueUndoAction('Linked task created', async () => {
        await deleteTask(taskId, { skipToast: true });
      });
    }
  }

  async function saveCurrentView() {
    const name = window.prompt('Name this saved contract view');
    if (!name || !name.trim()) return;
    const view = {
      id: createId('contract-view'),
      label: name.trim(),
      builtin: false,
      filters: {
        archived: getActiveSavedView().filters?.archived || 'active',
        tag: ContractsState.filterTag || '',
        owner: ContractsState.filterOwner || '',
        risk: ContractsState.filterRisk || '',
        search: ContractsState.searchQuery || ''
      },
      sort: getActiveSavedView().sort || 'board',
      order: getSavedContractViews().length
    };
    const nextViews = getSavedContractViews().concat(view);
    const success = await saveContractSavedViews(nextViews);
    if (success) {
      ContractsState.activeView = view.id;
      setStoredValue(CONTRACT_VIEW_KEY, view.id);
      renderContracts();
    }
  }

  function applyCustomViewFilters(view) {
    const filters = view.filters || {};
    if (filters.tag !== undefined) ContractsState.filterTag = filters.tag;
    if (filters.owner !== undefined) ContractsState.filterOwner = filters.owner;
    if (filters.risk !== undefined) ContractsState.filterRisk = filters.risk;
    if (filters.search !== undefined) ContractsState.searchQuery = filters.search;
    const search = document.getElementById('contract-search');
    if (search) search.value = ContractsState.searchQuery;
  }

  function handleHashDeepLink() {
    if (!window.location.hash.startsWith('#contract=')) return;
    if (!ContractsState.contractsLoaded) return;
    const id = decodeURIComponent(window.location.hash.replace('#contract=', ''));
    if (!id || (ContractsState.panelOpen && ContractsState.activeContractId === id)) return;
    const contract = ContractsState.contracts.find(item => item.id === id);
    if (contract) {
      ContractsState.hashHandled = true;
      openContractPanel(contract);
    }
  }

  function focusAdjacentCard(direction) {
    const active = document.activeElement?.closest?.('.contract-card');
    if (!active) return false;
    const currentColumn = active.closest('.contracts-column');
    const columns = Array.from(document.querySelectorAll('.contracts-column'));
    const index = columns.indexOf(currentColumn);
    const targetColumn = columns[index + direction];
    if (!targetColumn) return false;
    const target = targetColumn.querySelector('.contract-card');
    if (!target) return false;
    target.focus();
    return true;
  }

  function bindContractPageEvents() {
    document.getElementById('btn-theme')?.addEventListener('click', toggleTheme);
    document.getElementById('contract-search')?.addEventListener('input', event => {
      ContractsState.searchQuery = event.target.value.trim();
      renderContractsBoard();
    });
    document.getElementById('contract-saved-view')?.addEventListener('change', event => {
      ContractsState.activeView = event.target.value;
      setStoredValue(CONTRACT_VIEW_KEY, ContractsState.activeView);
      applyCustomViewFilters(getActiveSavedView());
      renderContracts();
    });
    document.getElementById('contract-filter-tag')?.addEventListener('change', event => {
      ContractsState.filterTag = event.target.value;
      renderContractsBoard();
    });
    document.getElementById('contract-filter-owner')?.addEventListener('change', event => {
      ContractsState.filterOwner = event.target.value;
      renderContractsBoard();
    });
    document.getElementById('contract-filter-risk')?.addEventListener('change', event => {
      ContractsState.filterRisk = event.target.value;
      renderContractsBoard();
    });
    document.getElementById('contract-density')?.addEventListener('change', event => {
      ContractsState.densityMode = event.target.value;
      setStoredValue(CONTRACT_DENSITY_KEY, ContractsState.densityMode);
      renderContractsBoard();
    });
    document.getElementById('contract-my-owner')?.addEventListener('change', event => {
      ContractsState.preferredOwner = event.target.value.trim();
      setStoredValue(CONTRACT_MY_OWNER_KEY, ContractsState.preferredOwner);
      renderContracts();
    });
    document.getElementById('contracts-clear-filters')?.addEventListener('click', () => {
      ContractsState.searchQuery = '';
      ContractsState.filterTag = '';
      ContractsState.filterOwner = '';
      ContractsState.filterRisk = '';
      const search = document.getElementById('contract-search');
      if (search) search.value = '';
      renderContracts();
    });
    document.getElementById('contract-new-btn')?.addEventListener('click', () => openContractPanel());
    document.getElementById('contract-board-settings-btn')?.addEventListener('click', openSettingsModal);
    document.getElementById('contracts-export-csv')?.addEventListener('click', exportFilteredContractsCsv);
    document.getElementById('contracts-print-renewals')?.addEventListener('click', printRenewalReport);
    document.getElementById('contracts-save-view')?.addEventListener('click', saveCurrentView);
    document.getElementById('contracts-panel-scrim')?.addEventListener('click', closeContractPanel);
    document.getElementById('contracts-settings-overlay')?.addEventListener('click', event => {
      if (event.target.id === 'contracts-settings-overlay') closeSettingsModal();
    });
    window.addEventListener('hashchange', handleHashDeepLink);

    document.addEventListener('change', async event => {
      const moveSelect = event.target.closest('[data-contract-move-select]');
      if (moveSelect) {
        event.preventDefault();
        event.stopPropagation();
        const contract = ContractsState.contracts.find(item => item.id === moveSelect.dataset.contractMoveSelect);
        if (!contract) return;
        await moveContractRecord(contract.id, moveSelect.value, null, 'after');
        showToast('Contract moved');
      }
    });

    document.addEventListener('click', async event => {
      const addColumnBtn = event.target.closest('[data-add-column-contract]');
      if (addColumnBtn) {
        openContractPanel({ columnId: addColumnBtn.dataset.addColumnContract });
        return;
      }

      const closePanelBtn = event.target.closest('#contracts-panel-close, #contract-cancel');
      if (closePanelBtn) {
        closeContractPanel();
        return;
      }

      if (event.target.closest('#contract-save')) {
        await handleSaveContract();
        return;
      }

      if (event.target.closest('#contract-delete')) {
        await handleDeleteContract();
        return;
      }

      if (event.target.closest('#contract-archive-toggle')) {
        toggleArchiveDraftDestination();
        return;
      }

      if (event.target.closest('#contract-copy-summary')) {
        await copyContractSummary();
        return;
      }

      if (event.target.closest('#contract-export-markdown')) {
        exportContractMarkdown();
        return;
      }

      if (event.target.closest('#contract-create-next-task')) {
        await createTaskFromContract('next');
        return;
      }

      if (event.target.closest('#contract-create-renewal-task')) {
        await createTaskFromContract('renewal');
        return;
      }

      const tagToggle = event.target.closest('[data-tag-toggle]');
      if (tagToggle) {
        toggleDraftTag(tagToggle.dataset.tagToggle);
        return;
      }

      if (event.target.closest('#contract-file-save')) {
        saveFileDraft();
        return;
      }

      if (event.target.closest('#contract-file-cancel')) {
        syncDraftFromPanel();
        resetFileDraft();
        renderContractsPanel();
        return;
      }

      const fileCopyBtn = event.target.closest('[data-file-copy]');
      if (fileCopyBtn) {
        syncDraftFromPanel();
        const file = (ContractsState.draft.files || []).find(item => item.id === fileCopyBtn.dataset.fileCopy);
        if (file) {
          await copyTextToClipboard(file.url, 'File link copied', 'Failed to copy file link');
        }
        return;
      }

      const fileEditBtn = event.target.closest('[data-file-edit]');
      if (fileEditBtn) {
        editFileDraft(fileEditBtn.dataset.fileEdit);
        return;
      }

      const fileRemoveBtn = event.target.closest('[data-file-remove]');
      if (fileRemoveBtn) {
        removeFileFromDraft(fileRemoveBtn.dataset.fileRemove);
        return;
      }

      if (event.target.closest('#contracts-settings-close, #contracts-settings-cancel')) {
        closeSettingsModal();
        return;
      }

      if (event.target.closest('#contracts-settings-save')) {
        await saveSettingsDraft();
        return;
      }

      const libraryAdd = event.target.closest('[data-library-add]');
      if (libraryAdd) {
        addLibraryItem(libraryAdd.dataset.libraryAdd);
        return;
      }

      const libraryDelete = event.target.closest('[data-library-delete]');
      if (libraryDelete) {
        deleteLibraryItem(libraryDelete.dataset.libraryDelete, libraryDelete.dataset.id);
        return;
      }

      const columnMoveBtn = event.target.closest('[data-column-move]');
      if (columnMoveBtn) {
        moveSettingsColumn(columnMoveBtn.dataset.columnId, columnMoveBtn.dataset.columnMove);
        return;
      }

      const contractCard = event.target.closest('.contract-card');
      if (contractCard) {
        if (ContractsState.suppressCardOpen || event.target.closest('button, a, input, select, textarea, label')) {
          event.preventDefault();
          return;
        }
        const contract = ContractsState.contracts.find(item => item.id === contractCard.dataset.contractId);
        if (contract) openContractPanel(contract);
      }
    });

    document.addEventListener('keydown', event => {
      const typing = event.target instanceof HTMLElement && (
        event.target.tagName === 'INPUT' ||
        event.target.tagName === 'TEXTAREA' ||
        event.target.tagName === 'SELECT' ||
        event.target.isContentEditable
      );

      if (event.key === 'Escape') {
        if (ContractsState.settingsOpen) {
          closeSettingsModal();
          return;
        }
        if (ContractsState.panelOpen) {
          closeContractPanel();
          return;
        }
      }

      const card = event.target.closest?.('.contract-card');
      if (card && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        const contract = ContractsState.contracts.find(item => item.id === card.dataset.contractId);
        if (contract) openContractPanel(contract);
        return;
      }

      if (typing) return;

      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        openContractPanel();
      } else if (event.key === '/') {
        event.preventDefault();
        document.getElementById('contract-search')?.focus();
      } else if (event.key === 'ArrowRight') {
        if (focusAdjacentCard(1)) event.preventDefault();
      } else if (event.key === 'ArrowLeft') {
        if (focusAdjacentCard(-1)) event.preventDefault();
      }
    });
  }

  window.renderContracts = function renderContracts() {
    if (!isContractsPage()) return;
    syncDraftFromPanel();
    syncSettingsDraftFromDom();
    renderContractsHeroStats();
    renderContractsAnalytics();
    renderContractsFilters();
    renderContractsBoard();
    renderContractsPanel();
    renderContractsSettings();
    handleHashDeepLink();
  };

  document.addEventListener('DOMContentLoaded', () => {
    if (!isContractsPage()) return;
    loadTheme();
    registerPlannerServiceWorker();
    setupUndoBar();
    bindContractPageEvents();
    setupContractsRealtimeSync();
  });
})();
