(function () {
  const INITIAL_BOARD_SETTINGS = typeof getDefaultContractBoardSettings === 'function'
    ? getDefaultContractBoardSettings()
    : { columns: [], tags: [] };

  const ContractsState = window.ContractsState || {
    contracts: [],
    boardSettings: INITIAL_BOARD_SETTINGS,
    contractsLoaded: false,
    settingsLoaded: false,
    searchQuery: '',
    filterTag: '',
    filterOwner: '',
    panelOpen: false,
    activeContractId: null,
    draft: null,
    fileDraft: null,
    editingFileId: null,
    settingsOpen: false,
    settingsDraft: null,
    draggedContractId: null
  };
  window.ContractsState = ContractsState;

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
      note: source.note || ''
    };
  }

  function getNormalizedContractSettings() {
    return normalizeContractBoardSettings(ContractsState.boardSettings);
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

  function buildContractDraft(source) {
    return normalizeContract({
      title: '',
      counterparty: '',
      owner: '',
      columnId: getDefaultContractColumnId(),
      previousColumnId: getDefaultContractColumnId(),
      sortOrder: 0,
      tags: [],
      effectiveDate: null,
      renewalDate: null,
      statusNote: '',
      notes: '',
      archived: false,
      archivedAt: null,
      createdAt: null,
      updatedAt: null,
      files: [],
      ...source
    });
  }

  function getContractTagMap() {
    const map = new Map();
    getNormalizedContractSettings().tags.forEach(tag => {
      map.set(tag.id, tag);
    });
    return map;
  }

  function getContractTag(tagId) {
    return getContractTagMap().get(tagId) || null;
  }

  function getContractDisplayTag(tagId) {
    const knownTag = getContractTag(tagId);
    if (knownTag) return knownTag;
    return {
      id: tagId,
      label: tagId,
      color: '#6366f1'
    };
  }

  function getContractColumnById(columnId) {
    return getContractColumns().find(column => column.id === columnId) || null;
  }

  function getContractColumnLabel(columnId) {
    const column = getContractColumnById(columnId);
    return column ? column.label : 'Unknown';
  }

  function getContractSearchValues(contract) {
    const tagLabels = (contract.tags || []).map(tagId => getContractDisplayTag(tagId).label).join(' ');
    const fileLabels = (contract.files || []).map(file => [file.label, file.type, file.note].filter(Boolean).join(' ')).join(' ');
    return [
      contract.title,
      contract.counterparty,
      contract.owner,
      contract.statusNote,
      contract.notes,
      tagLabels,
      fileLabels
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function getFilteredContracts() {
    return ContractsState.contracts.filter(contract => {
      if (ContractsState.searchQuery) {
        const haystack = getContractSearchValues(contract);
        if (!haystack.includes(ContractsState.searchQuery.toLowerCase())) return false;
      }
      if (ContractsState.filterTag && !(contract.tags || []).includes(ContractsState.filterTag)) return false;
      if (ContractsState.filterOwner && (contract.owner || '') !== ContractsState.filterOwner) return false;
      return true;
    });
  }

  function sortContracts(contracts) {
    return [...contracts].sort((a, b) => {
      const orderDiff = (a.sortOrder || 0) - (b.sortOrder || 0);
      if (orderDiff !== 0) return orderDiff;
      const updatedDiff = new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
      if (updatedDiff !== 0) return updatedDiff;
      return (a.title || '').localeCompare(b.title || '');
    });
  }

  function getContractsForColumn(columnId, contracts = getFilteredContracts()) {
    if (columnId === CONTRACT_ARCHIVED_COLUMN_ID) {
      return sortContracts(contracts.filter(contract => contract.archived));
    }
    return sortContracts(contracts.filter(contract => !contract.archived && contract.columnId === columnId));
  }

  function getRenewalWindowCount(days = 30) {
    const now = parseDateOnly(getTodayString());
    const cutoff = parseDateOnly(addDays(getTodayString(), days));
    return ContractsState.contracts.filter(contract => {
      if (contract.archived || !contract.renewalDate) return false;
      const renewal = parseDateOnly(contract.renewalDate);
      return renewal >= now && renewal <= cutoff;
    }).length;
  }

  function getContractsStats() {
    return {
      active: ContractsState.contracts.filter(contract => !contract.archived).length,
      renewalsSoon: getRenewalWindowCount(30),
      fileCount: ContractsState.contracts.reduce((count, contract) => count + (contract.files || []).length, 0)
    };
  }

  function formatContractDate(dateStr) {
    if (!dateStr) return 'No date';
    return parseDateOnly(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function isContractRenewalSoon(contract) {
    if (!contract.renewalDate || contract.archived) return false;
    const today = parseDateOnly(getTodayString());
    const renewal = parseDateOnly(contract.renewalDate);
    const diffDays = Math.round((renewal.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    return diffDays >= 0 && diffDays <= 30;
  }

  function isValidContractUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  function renderTagChip(tagId) {
    const tag = getContractDisplayTag(tagId);
    return (
      '<span class="contract-tag-chip">' +
        '<span class="contracts-column-dot" style="background:' + escapeHtml(tag.color) + '"></span>' +
        escapeHtml(tag.label) +
      '</span>'
    );
  }

  function renderContractCard(contract) {
    const tags = (contract.tags || []).slice(0, 3).map(renderTagChip).join('');
    const extraTags = (contract.tags || []).length > 3
      ? '<span class="contract-chip">+' + ((contract.tags || []).length - 3) + ' tags</span>'
      : '';
    const filePreview = (contract.files || []).slice(0, 2).map(file => (
      '<div class="contract-card-file">• ' + escapeHtml(file.label) + '</div>'
    )).join('');
    const fileSummary = (contract.files || []).length
      ? '<div class="contract-card-files">' +
          '<div class="contract-chip">' + (contract.files || []).length + ' file' + ((contract.files || []).length === 1 ? '' : 's') + '</div>' +
          filePreview +
        '</div>'
      : '<div class="contract-card-files"><div class="contract-chip">No files yet</div></div>';
    const renewalChip = contract.renewalDate
      ? '<span class="contract-chip' + (isContractRenewalSoon(contract) ? ' renewal-soon' : '') + '">' +
          'Renewal ' + escapeHtml(formatContractDate(contract.renewalDate)) +
        '</span>'
      : '';
    const archivedChip = contract.archived ? '<span class="contract-chip archived">Archived</span>' : '';
    const statusPreview = contract.statusNote
      ? '<div class="contract-card-status">' + escapeHtml(contract.statusNote) + '</div>'
      : '';

    return (
      '<article class="contract-card" data-contract-id="' + contract.id + '" draggable="true">' +
        '<div class="contract-card-topline">' +
          '<div>' +
            '<div class="contract-card-title">' + escapeHtml(contract.title || 'Untitled contract') + '</div>' +
            '<div class="contract-card-subtitle">' + escapeHtml(contract.counterparty || 'Add a counterparty') + '</div>' +
          '</div>' +
          '<span class="contract-card-handle" aria-hidden="true">⋮⋮</span>' +
        '</div>' +
        '<div class="contract-card-meta">' +
          (contract.owner ? '<span class="contract-chip">Owner: ' + escapeHtml(contract.owner) + '</span>' : '') +
          renewalChip +
          archivedChip +
          tags +
          extraTags +
        '</div>' +
        statusPreview +
        fileSummary +
        '<div class="contract-card-footer">' +
          '<div class="contract-card-owner">Updated ' + escapeHtml(formatRelativeTime(contract.updatedAt || contract.createdAt)) + '</div>' +
          '<div class="contract-card-open">Open →</div>' +
        '</div>' +
      '</article>'
    );
  }

  function renderContractsHeroStats() {
    const stats = getContractsStats();
    const activeEl = document.getElementById('contracts-stat-active');
    const renewalsEl = document.getElementById('contracts-stat-renewals');
    const filesEl = document.getElementById('contracts-stat-files');
    if (activeEl) activeEl.textContent = String(stats.active);
    if (renewalsEl) renewalsEl.textContent = String(stats.renewalsSoon);
    if (filesEl) filesEl.textContent = String(stats.fileCount);
  }

  function renderContractsFilters() {
    const allTags = getNormalizedContractSettings().tags;
    const allOwners = [...new Set(ContractsState.contracts.map(contract => contract.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const tagSelect = document.getElementById('contract-filter-tag');
    const ownerSelect = document.getElementById('contract-filter-owner');
    const searchInput = document.getElementById('contract-search');

    if (searchInput && searchInput.value !== ContractsState.searchQuery) {
      searchInput.value = ContractsState.searchQuery;
    }

    if (tagSelect) {
      tagSelect.innerHTML = '<option value="">All tags</option>' + allTags.map(tag => {
        return '<option value="' + escapeHtml(tag.id) + '">' + escapeHtml(tag.label) + '</option>';
      }).join('');
      tagSelect.value = allTags.some(tag => tag.id === ContractsState.filterTag) ? ContractsState.filterTag : '';
      if (!tagSelect.value) ContractsState.filterTag = '';
    }

    if (ownerSelect) {
      ownerSelect.innerHTML = '<option value="">All owners</option>' + allOwners.map(owner => {
        return '<option value="' + escapeHtml(owner) + '">' + escapeHtml(owner) + '</option>';
      }).join('');
      ownerSelect.value = allOwners.includes(ContractsState.filterOwner) ? ContractsState.filterOwner : '';
      if (!ownerSelect.value) ContractsState.filterOwner = '';
    }
  }

  function renderContractsBoard() {
    const board = document.getElementById('contracts-board');
    const emptyState = document.getElementById('contracts-empty-state');
    const columns = getContractColumns();
    const filteredContracts = getFilteredContracts();

    board.innerHTML = columns.map(column => {
      const contracts = getContractsForColumn(column.id, filteredContracts);
      const subtitle = column.id === CONTRACT_ARCHIVED_COLUMN_ID
        ? 'Archived agreements stay out of the way but remain easy to reopen.'
        : 'Drag contracts here to update their workflow stage.';

      return (
        '<section class="contracts-column" data-column-id="' + escapeHtml(column.id) + '">' +
          '<div class="contracts-column-header">' +
            '<div class="contracts-column-kicker">' +
              '<span><span class="contracts-column-dot" style="background:' + escapeHtml(column.color) + '"></span> Workflow</span>' +
              '<button class="contracts-inline-icon-btn" type="button" data-add-column-contract="' + escapeHtml(column.id) + '" aria-label="Add contract to ' + escapeHtml(column.label) + '">+</button>' +
            '</div>' +
            '<div class="contracts-column-title-row">' +
              '<div class="contracts-column-title">' + escapeHtml(column.label) + '</div>' +
              '<div class="contracts-column-count">' + contracts.length + '</div>' +
            '</div>' +
            '<div class="contracts-column-subtitle">' + escapeHtml(subtitle) + '</div>' +
          '</div>' +
          '<div class="contracts-column-body" data-column-drop="' + escapeHtml(column.id) + '">' +
            (contracts.length
              ? contracts.map(renderContractCard).join('')
              : '<div class="contracts-column-empty">No contracts here yet. Add one or drag one over.</div>') +
          '</div>' +
        '</section>'
      );
    }).join('');

    emptyState.hidden = filteredContracts.length > 0;
    bindContractBoardDragAndDrop();
  }

  function renderContractsPanel() {
    const panel = document.getElementById('contracts-panel');
    const panelContent = document.getElementById('contracts-panel-content');
    const scrim = document.getElementById('contracts-panel-scrim');

    if (!ContractsState.panelOpen || !ContractsState.draft) {
      panel.hidden = true;
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
      scrim.hidden = true;
      panelContent.innerHTML = '';
      return;
    }

    const draft = ContractsState.draft;
    const isExisting = !!draft.id && ContractsState.contracts.some(contract => contract.id === draft.id);
    const columns = getContractColumns();
    const tags = getNormalizedContractSettings().tags;
    const fileDraft = ContractsState.fileDraft || createEmptyFileDraft();
    const filesHtml = (draft.files || []).length
      ? draft.files.map(file => {
          return (
            '<div class="contracts-file-item">' +
              '<div>' +
                '<div class="contracts-file-title">' + escapeHtml(file.label) + '</div>' +
                '<div class="contracts-file-meta">' +
                  (file.type ? escapeHtml(file.type) + ' · ' : '') +
                  '<a class="contracts-inline-link" href="' + escapeHtml(file.url) + '" target="_blank" rel="noopener noreferrer">Open link</a>' +
                  (file.note ? ' · ' + escapeHtml(file.note) : '') +
                '</div>' +
              '</div>' +
              '<div class="contracts-row-actions">' +
                '<button class="contracts-inline-icon-btn" type="button" data-file-edit="' + escapeHtml(file.id) + '">Edit</button>' +
                '<button class="contracts-inline-icon-btn" type="button" data-file-remove="' + escapeHtml(file.id) + '">Remove</button>' +
              '</div>' +
            '</div>'
          );
        }).join('')
      : '<div class="contracts-empty-inline">No linked files yet. Add agreements, schedules, shared drives, or reference docs here.</div>';

    panelContent.innerHTML = (
      '<div class="contracts-panel-head">' +
        '<div>' +
          '<div class="contracts-panel-title">' + escapeHtml(isExisting ? draft.title || 'Untitled contract' : 'New contract') + '</div>' +
          '<div class="contracts-panel-subtitle">' + escapeHtml(isExisting ? 'Edit workflow, metadata, files, and notes.' : 'Add a contract and place it on the board.') + '</div>' +
        '</div>' +
        '<button class="contracts-panel-close" id="contracts-panel-close" type="button" aria-label="Close contract panel">✕</button>' +
      '</div>' +

      '<div class="contracts-panel-grid">' +
        '<div class="contracts-panel-field full">' +
          '<label class="contracts-panel-label" for="contract-title">Contract title</label>' +
          '<input id="contract-title" class="contracts-panel-input" type="text" value="' + escapeHtml(draft.title || '') + '" placeholder="Master service agreement">' +
        '</div>' +
        '<div class="contracts-panel-field">' +
          '<label class="contracts-panel-label" for="contract-counterparty">Counterparty</label>' +
          '<input id="contract-counterparty" class="contracts-panel-input" type="text" value="' + escapeHtml(draft.counterparty || '') + '" placeholder="False Creek Imaging">' +
        '</div>' +
        '<div class="contracts-panel-field">' +
          '<label class="contracts-panel-label" for="contract-owner">Owner</label>' +
          '<input id="contract-owner" class="contracts-panel-input" type="text" value="' + escapeHtml(draft.owner || '') + '" placeholder="Jason">' +
        '</div>' +
        '<div class="contracts-panel-field">' +
          '<label class="contracts-panel-label" for="contract-column">Workflow column</label>' +
          '<select id="contract-column" class="contracts-panel-select">' +
            columns.map(column => (
              '<option value="' + escapeHtml(column.id) + '"' + (draft.columnId === column.id ? ' selected' : '') + '>' + escapeHtml(column.label) + '</option>'
            )).join('') +
          '</select>' +
        '</div>' +
        '<div class="contracts-panel-field">' +
          '<label class="contracts-panel-label" for="contract-effective-date">Effective date</label>' +
          '<input id="contract-effective-date" class="contracts-panel-input" type="date" value="' + escapeHtml(draft.effectiveDate || '') + '">' +
        '</div>' +
        '<div class="contracts-panel-field">' +
          '<label class="contracts-panel-label" for="contract-renewal-date">Renewal date</label>' +
          '<input id="contract-renewal-date" class="contracts-panel-input" type="date" value="' + escapeHtml(draft.renewalDate || '') + '">' +
        '</div>' +
      '</div>' +

      '<div class="contracts-panel-section">' +
        '<label class="contracts-panel-label">Tags</label>' +
        '<div class="contracts-tag-grid">' +
          (tags.length
            ? tags.map(tag => {
                const active = (draft.tags || []).includes(tag.id);
                return (
                  '<button class="contract-tag-toggle' + (active ? ' active' : '') + '" type="button" data-tag-toggle="' + escapeHtml(tag.id) + '" style="color:' + escapeHtml(tag.color) + '">' +
                    '<span class="contracts-column-dot" style="background:' + escapeHtml(tag.color) + '"></span>' +
                    escapeHtml(tag.label) +
                  '</button>'
                );
              }).join('')
            : '<div class="contracts-empty-inline">Create tags in Board settings to label contracts here.</div>') +
        '</div>' +
      '</div>' +

      '<div class="contracts-panel-section">' +
        '<label class="contracts-panel-label" for="contract-status-note">Status note</label>' +
        '<textarea id="contract-status-note" class="contracts-panel-textarea status" placeholder="Waiting on final signature page...">' + escapeHtml(draft.statusNote || '') + '</textarea>' +
        '<div class="contracts-panel-help">Use this for the latest blocker, owner handoff, or next step.</div>' +
      '</div>' +

      '<div class="contracts-panel-section">' +
        '<label class="contracts-panel-label" for="contract-notes">Notes</label>' +
        '<textarea id="contract-notes" class="contracts-panel-textarea" placeholder="Capture key clauses, renewal context, or negotiation details.">' + escapeHtml(draft.notes || '') + '</textarea>' +
      '</div>' +

      '<div class="contracts-panel-section contracts-panel-section-card">' +
        '<label class="contracts-panel-label">Files</label>' +
        '<div class="contracts-file-list">' + filesHtml + '</div>' +
        '<div class="contracts-file-form">' +
          '<div>' +
            '<label class="contracts-panel-label" for="contract-file-label">Label</label>' +
            '<input id="contract-file-label" class="contracts-panel-input" type="text" value="' + escapeHtml(fileDraft.label || '') + '" placeholder="Master Agreement">' +
          '</div>' +
          '<div>' +
            '<label class="contracts-panel-label" for="contract-file-type">Type</label>' +
            '<input id="contract-file-type" class="contracts-panel-input" type="text" value="' + escapeHtml(fileDraft.type || '') + '" placeholder="PDF, Drive folder, Link">' +
          '</div>' +
          '<div class="full">' +
            '<label class="contracts-panel-label" for="contract-file-url">URL</label>' +
            '<input id="contract-file-url" class="contracts-panel-input" type="url" value="' + escapeHtml(fileDraft.url || '') + '" placeholder="https://...">' +
          '</div>' +
          '<div class="full">' +
            '<label class="contracts-panel-label" for="contract-file-note">Note</label>' +
            '<input id="contract-file-note" class="contracts-panel-input" type="text" value="' + escapeHtml(fileDraft.note || '') + '" placeholder="Optional context for this file">' +
          '</div>' +
        '</div>' +
        '<div class="contracts-panel-actions-main" style="margin-top:12px">' +
          '<button class="btn btn-secondary" id="contract-file-cancel" type="button"' + (ContractsState.editingFileId ? '' : ' hidden') + '>Cancel file edit</button>' +
          '<button class="btn btn-primary" id="contract-file-save" type="button">' + (ContractsState.editingFileId ? 'Update file' : 'Add file link') + '</button>' +
        '</div>' +
      '</div>' +

      '<div class="contracts-panel-actions">' +
        '<div class="contracts-panel-actions-side">' +
          (isExisting ? '<button class="btn btn-danger" id="contract-delete" type="button">Delete</button>' : '') +
        '</div>' +
        '<div class="contracts-panel-actions-main">' +
          '<button class="btn btn-secondary" id="contract-archive-toggle" type="button">' + (draft.columnId === CONTRACT_ARCHIVED_COLUMN_ID ? 'Move to active' : 'Move to Archived') + '</button>' +
          '<button class="btn btn-secondary" id="contract-cancel" type="button">Cancel</button>' +
          '<button class="btn btn-primary" id="contract-save" type="button">Save contract</button>' +
        '</div>' +
      '</div>'
    );

    panel.hidden = false;
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    scrim.hidden = false;
  }

  function renderContractsSettings() {
    const overlay = document.getElementById('contracts-settings-overlay');
    const content = document.getElementById('contracts-settings-content');
    if (!ContractsState.settingsOpen || !ContractsState.settingsDraft) {
      overlay.hidden = true;
      content.innerHTML = '';
      return;
    }

    const draft = ContractsState.settingsDraft;
    content.innerHTML = (
      '<div class="contracts-settings-head">' +
        '<div>' +
          '<div class="contracts-settings-title" id="contracts-settings-title">Board settings</div>' +
          '<div class="contracts-settings-subtitle">Adjust workflow columns and the tag library that contracts can use.</div>' +
        '</div>' +
        '<button class="contracts-settings-close" id="contracts-settings-close" type="button" aria-label="Close board settings">✕</button>' +
      '</div>' +
      '<div class="contracts-settings-grid">' +
        '<section class="contracts-settings-section">' +
          '<div class="contracts-settings-section-label">Columns</div>' +
          '<div class="contracts-settings-list">' +
            draft.columns.map((column, index) => {
              const locked = column.id === CONTRACT_ARCHIVED_COLUMN_ID;
              return (
                '<div class="contracts-settings-row' + (locked ? ' locked' : '') + '" data-column-row-id="' + escapeHtml(column.id) + '">' +
                  '<input class="contracts-settings-input" data-column-label="' + escapeHtml(column.id) + '" type="text" value="' + escapeHtml(column.label) + '"' + (locked ? '' : '') + '>' +
                  '<input class="contracts-settings-input" data-column-color="' + escapeHtml(column.id) + '" type="color" value="' + escapeHtml(column.color) + '">' +
                  '<div class="contracts-row-actions">' +
                    (locked ? '' : '<button class="contracts-inline-icon-btn" type="button" data-column-move="up" data-column-id="' + escapeHtml(column.id) + '"' + (index === 0 ? ' disabled' : '') + '>↑</button>') +
                    (locked ? '' : '<button class="contracts-inline-icon-btn" type="button" data-column-move="down" data-column-id="' + escapeHtml(column.id) + '"' + (index === draft.columns.length - 2 ? ' disabled' : '') + '>↓</button>') +
                    (locked ? '<span class="contracts-panel-help">Locked</span>' : '<button class="contracts-inline-icon-btn" type="button" data-column-delete="' + escapeHtml(column.id) + '">Delete</button>') +
                  '</div>' +
                '</div>'
              );
            }).join('') +
          '</div>' +
          '<div class="contracts-settings-actions">' +
            '<button class="btn btn-secondary" id="contracts-add-column" type="button">+ Add column</button>' +
          '</div>' +
          '<div class="contracts-settings-helper">Archived stays as the final board lane so archived contracts always have a home.</div>' +
        '</section>' +
        '<section class="contracts-settings-section">' +
          '<div class="contracts-settings-section-label">Tags</div>' +
          '<div class="contracts-settings-list">' +
            (draft.tags.length
              ? draft.tags.map(tag => (
                  '<div class="contracts-settings-row" data-tag-row-id="' + escapeHtml(tag.id) + '">' +
                    '<input class="contracts-settings-input" data-tag-label="' + escapeHtml(tag.id) + '" type="text" value="' + escapeHtml(tag.label) + '">' +
                    '<input class="contracts-settings-input" data-tag-color="' + escapeHtml(tag.id) + '" type="color" value="' + escapeHtml(tag.color) + '">' +
                    '<div class="contracts-row-actions">' +
                      '<button class="contracts-inline-icon-btn" type="button" data-tag-delete="' + escapeHtml(tag.id) + '">Delete</button>' +
                    '</div>' +
                  '</div>'
                )).join('')
              : '<div class="contracts-empty-inline">No tags yet. Add one to start labelling contracts.</div>') +
          '</div>' +
          '<div class="contracts-settings-actions">' +
            '<button class="btn btn-secondary" id="contracts-add-tag" type="button">+ Add tag</button>' +
          '</div>' +
          '<div class="contracts-settings-helper">Tags are global and can be reused across contracts for themes like renewal, imaging, legal, or waiting.</div>' +
        '</section>' +
      '</div>' +
      '<div class="contracts-settings-actions">' +
        '<button class="btn btn-secondary" id="contracts-settings-cancel" type="button">Cancel</button>' +
        '<button class="btn btn-primary" id="contracts-settings-save" type="button">Save settings</button>' +
      '</div>'
    );

    overlay.hidden = false;
  }

  function syncDraftFromPanel() {
    if (!ContractsState.panelOpen || !ContractsState.draft) return;
    const title = document.getElementById('contract-title');
    const counterparty = document.getElementById('contract-counterparty');
    const owner = document.getElementById('contract-owner');
    const column = document.getElementById('contract-column');
    const effectiveDate = document.getElementById('contract-effective-date');
    const renewalDate = document.getElementById('contract-renewal-date');
    const statusNote = document.getElementById('contract-status-note');
    const notes = document.getElementById('contract-notes');

    if (title) ContractsState.draft.title = title.value.trim();
    if (counterparty) ContractsState.draft.counterparty = counterparty.value.trim();
    if (owner) ContractsState.draft.owner = owner.value.trim();
    if (column) ContractsState.draft.columnId = column.value;
    if (effectiveDate) ContractsState.draft.effectiveDate = effectiveDate.value || null;
    if (renewalDate) ContractsState.draft.renewalDate = renewalDate.value || null;
    if (statusNote) ContractsState.draft.statusNote = statusNote.value.trim();
    if (notes) ContractsState.draft.notes = notes.value.trim();

    ContractsState.draft.archived = ContractsState.draft.columnId === CONTRACT_ARCHIVED_COLUMN_ID;
    if (!ContractsState.draft.archived) {
      ContractsState.draft.previousColumnId = ContractsState.draft.columnId;
    }

    const fileLabel = document.getElementById('contract-file-label');
    const fileType = document.getElementById('contract-file-type');
    const fileUrl = document.getElementById('contract-file-url');
    const fileNote = document.getElementById('contract-file-note');

    ContractsState.fileDraft = {
      id: ContractsState.editingFileId || null,
      label: fileLabel ? fileLabel.value.trim() : '',
      type: fileType ? fileType.value.trim() : '',
      url: fileUrl ? fileUrl.value.trim() : '',
      note: fileNote ? fileNote.value.trim() : ''
    };
  }

  function syncSettingsDraftFromDom() {
    if (!ContractsState.settingsOpen || !ContractsState.settingsDraft) return;

    const columns = [];
    document.querySelectorAll('[data-column-row-id]').forEach((row, index) => {
      const id = row.dataset.columnRowId;
      const labelInput = row.querySelector('[data-column-label]');
      const colorInput = row.querySelector('[data-column-color]');
      columns.push({
        id,
        label: labelInput ? labelInput.value.trim() : '',
        color: colorInput ? colorInput.value : '#6366f1',
        order: index
      });
    });

    const tags = [];
    document.querySelectorAll('[data-tag-row-id]').forEach((row, index) => {
      const id = row.dataset.tagRowId;
      const labelInput = row.querySelector('[data-tag-label]');
      const colorInput = row.querySelector('[data-tag-color]');
      tags.push({
        id,
        label: labelInput ? labelInput.value.trim() : '',
        color: colorInput ? colorInput.value : '#6366f1',
        order: index
      });
    });

    ContractsState.settingsDraft = {
      columns,
      tags
    };
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
    requestAnimationFrame(() => {
      const input = document.getElementById('contract-title');
      if (input) input.focus();
    });
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
    if (ContractsState.editingFileId === fileId) {
      resetFileDraft();
    }
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

    const normalized = normalizeContractFile({
      id: ContractsState.editingFileId || createId('contract-file'),
      label: draft.label,
      url: draft.url,
      type: draft.type,
      note: draft.note
    });
    if (!normalized) {
      showToast('Could not save that file link');
      return;
    }

    const files = (ContractsState.draft.files || []).slice();
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
    const savedId = await saveContractRecord(ContractsState.draft, existing || null);
    if (!savedId) return;
    closeContractPanel();
  }

  async function handleDeleteContract() {
    if (!ContractsState.activeContractId) {
      closeContractPanel();
      return;
    }
    const existing = ContractsState.contracts.find(contract => contract.id === ContractsState.activeContractId);
    if (!existing) return;
    const success = await deleteContractRecordWithUndo(existing);
    if (success) closeContractPanel();
  }

  function toggleArchiveDraftDestination() {
    syncDraftFromPanel();
    if (!ContractsState.draft) return;
    if (ContractsState.draft.columnId === CONTRACT_ARCHIVED_COLUMN_ID) {
      ContractsState.draft.columnId = ContractsState.draft.previousColumnId || getDefaultContractColumnId();
    } else {
      ContractsState.draft.previousColumnId = ContractsState.draft.columnId || getDefaultContractColumnId();
      ContractsState.draft.columnId = CONTRACT_ARCHIVED_COLUMN_ID;
    }
    ContractsState.draft.archived = ContractsState.draft.columnId === CONTRACT_ARCHIVED_COLUMN_ID;
    renderContractsPanel();
  }

  function validateSettingsDraft() {
    const draft = normalizeContractBoardSettings(ContractsState.settingsDraft || getNormalizedContractSettings());
    if (!draft.columns.every(column => column.label.trim())) {
      showToast('Every column needs a label');
      return null;
    }
    if (!draft.tags.every(tag => tag.label.trim())) {
      showToast('Every tag needs a label');
      return null;
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

  function addSettingsColumn() {
    syncSettingsDraftFromDom();
    const draft = normalizeContractBoardSettings(ContractsState.settingsDraft || getNormalizedContractSettings());
    draft.columns.splice(Math.max(0, draft.columns.length - 1), 0, {
      id: createId('contract-column'),
      label: 'New Column',
      color: '#6366f1',
      order: draft.columns.length - 1
    });
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
    ContractsState.settingsDraft = {
      columns: activeColumns.concat(archived ? [archived] : []),
      tags: draft.tags
    };
    renderContractsSettings();
  }

  function deleteSettingsColumn(columnId) {
    const hasContracts = ContractsState.contracts.some(contract => !contract.archived && contract.columnId === columnId);
    if (hasContracts) {
      showToast('Move contracts out of that column before deleting it');
      return;
    }
    syncSettingsDraftFromDom();
    const draft = normalizeContractBoardSettings(ContractsState.settingsDraft || getNormalizedContractSettings());
    draft.columns = draft.columns.filter(column => column.id !== columnId);
    ContractsState.settingsDraft = draft;
    renderContractsSettings();
  }

  function addSettingsTag() {
    syncSettingsDraftFromDom();
    const draft = normalizeContractBoardSettings(ContractsState.settingsDraft || getNormalizedContractSettings());
    draft.tags.push({
      id: createId('contract-tag'),
      label: 'New Tag',
      color: '#8b5cf6',
      order: draft.tags.length
    });
    ContractsState.settingsDraft = draft;
    renderContractsSettings();
  }

  function deleteSettingsTag(tagId) {
    const inUse = ContractsState.contracts.some(contract => (contract.tags || []).includes(tagId));
    if (inUse) {
      showToast('Remove that tag from contracts before deleting it');
      return;
    }
    syncSettingsDraftFromDom();
    const draft = normalizeContractBoardSettings(ContractsState.settingsDraft || getNormalizedContractSettings());
    draft.tags = draft.tags.filter(tag => tag.id !== tagId);
    ContractsState.settingsDraft = draft;
    renderContractsSettings();
  }

  function clearContractDragState() {
    ContractsState.draggedContractId = null;
    document.querySelectorAll('.contract-card.dragging, .contract-card.drag-over-top, .contract-card.drag-over-bottom').forEach(card => {
      card.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
    });
    document.querySelectorAll('.contracts-column.drag-over-column').forEach(column => {
      column.classList.remove('drag-over-column');
    });
  }

  function bindContractBoardDragAndDrop() {
    document.querySelectorAll('.contract-card').forEach(card => {
      const contractId = card.dataset.contractId;
      card.addEventListener('dragstart', event => {
        ContractsState.draggedContractId = contractId;
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', contractId);
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
        const column = card.closest('.contracts-column');
        if (column) column.classList.add('drag-over-column');
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
      card.addEventListener('dragend', clearContractDragState);
    });

    document.querySelectorAll('[data-column-drop]').forEach(body => {
      body.addEventListener('dragover', event => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        const column = body.closest('.contracts-column');
        if (column) column.classList.add('drag-over-column');
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

  function bindContractPageEvents() {
    document.getElementById('btn-theme').addEventListener('click', toggleTheme);
    document.getElementById('contract-search').addEventListener('input', event => {
      ContractsState.searchQuery = event.target.value.trim();
      renderContractsBoard();
    });
    document.getElementById('contract-filter-tag').addEventListener('change', event => {
      ContractsState.filterTag = event.target.value;
      renderContractsBoard();
    });
    document.getElementById('contract-filter-owner').addEventListener('change', event => {
      ContractsState.filterOwner = event.target.value;
      renderContractsBoard();
    });
    document.getElementById('contracts-clear-filters').addEventListener('click', () => {
      ContractsState.searchQuery = '';
      ContractsState.filterTag = '';
      ContractsState.filterOwner = '';
      renderContracts();
    });
    document.getElementById('contract-new-btn').addEventListener('click', () => {
      openContractPanel();
    });
    document.getElementById('contract-board-settings-btn').addEventListener('click', openSettingsModal);
    document.getElementById('contracts-panel-scrim').addEventListener('click', closeContractPanel);
    document.getElementById('contracts-settings-overlay').addEventListener('click', event => {
      if (event.target.id === 'contracts-settings-overlay') closeSettingsModal();
    });

    document.addEventListener('click', async event => {
      const addColumnBtn = event.target.closest('[data-add-column-contract]');
      if (addColumnBtn) {
        openContractPanel({ columnId: addColumnBtn.dataset.addColumnContract });
        return;
      }

      const contractCard = event.target.closest('.contract-card');
      if (contractCard) {
        const contract = ContractsState.contracts.find(item => item.id === contractCard.dataset.contractId);
        if (contract) openContractPanel(contract);
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

      if (event.target.closest('#contracts-add-column')) {
        addSettingsColumn();
        return;
      }

      if (event.target.closest('#contracts-add-tag')) {
        addSettingsTag();
        return;
      }

      const columnMoveBtn = event.target.closest('[data-column-move]');
      if (columnMoveBtn) {
        moveSettingsColumn(columnMoveBtn.dataset.columnId, columnMoveBtn.dataset.columnMove);
        return;
      }

      const columnDeleteBtn = event.target.closest('[data-column-delete]');
      if (columnDeleteBtn) {
        deleteSettingsColumn(columnDeleteBtn.dataset.columnDelete);
        return;
      }

      const tagDeleteBtn = event.target.closest('[data-tag-delete]');
      if (tagDeleteBtn) {
        deleteSettingsTag(tagDeleteBtn.dataset.tagDelete);
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (ContractsState.settingsOpen) {
        closeSettingsModal();
        return;
      }
      if (ContractsState.panelOpen) {
        closeContractPanel();
      }
    });
  }

  window.renderContracts = function renderContracts() {
    if (!isContractsPage()) return;
    syncDraftFromPanel();
    syncSettingsDraftFromDom();
    renderContractsHeroStats();
    renderContractsFilters();
    renderContractsBoard();
    renderContractsPanel();
    renderContractsSettings();
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
