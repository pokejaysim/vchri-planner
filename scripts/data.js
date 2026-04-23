    /* ───────────── Firebase Operations ───────────── */
    async function addTask(task, options = {}) {
      try {
        setSyncStatus('syncing');
        const dateTasks = State.tasks.filter(t => t.date === task.date && !t.archived);
        const timestamp = getCurrentTimestamp();
        task.sortOrder = dateTasks.length ? Math.max(...dateTasks.map(t => t.sortOrder || 0)) + 1 : 0;
        task.createdAt = task.createdAt || timestamp;
        task.updatedAt = timestamp;
        task.archived = !!task.archived;
        task.archivedAt = task.archived ? (task.archivedAt || timestamp) : null;
        task.subtasks = normalizeSubtasks(task.subtasks);
        const docRef = await db.collection('planner_tasks').add(task);
        // Don't push locally - realtime sync will handle it
        setSyncStatus('synced');
        if (!options.skipToast) {
          showToast(options.toastMessage || 'Task added!');
        }
        return docRef.id;
      } catch (e) {
        console.error('Add error:', e);
        setSyncStatus('offline');
        if (!options.skipToast) showToast('Failed to add task');
        return null;
      }
    }

    async function updateTask(id, updates) {
      try {
        setSyncStatus('syncing');
        await db.collection('planner_tasks').doc(id).update({
          ...updates,
          updatedAt: getCurrentTimestamp()
        });
        // Don't update locally - realtime sync will handle it
        setSyncStatus('synced');
        return true;
      } catch (e) {
        console.error('Update error:', e);
        setSyncStatus('offline');
        showToast('Failed to update task');
        return false;
      }
    }

    async function deleteTask(id, options = {}) {
      try {
        setSyncStatus('syncing');
        await db.collection('planner_tasks').doc(id).delete();
        // Don't update locally - realtime sync will handle it
        setSyncStatus('synced');
        if (!options.skipToast) showToast('Task deleted');
        return true;
      } catch (e) {
        console.error('Delete error:', e);
        setSyncStatus('offline');
        if (!options.skipToast) showToast('Failed to delete task');
        return false;
      }
    }

    async function restoreTaskSnapshot(taskSnapshot, options = {}) {
      if (!taskSnapshot || !taskSnapshot.id) return false;
      try {
        setSyncStatus('syncing');
        const { id, ...taskData } = cloneTaskSnapshot(taskSnapshot);
        await db.collection('planner_tasks').doc(id).set(taskData);
        setSyncStatus('synced');
        if (!options.skipToast) showToast('Task restored');
        return true;
      } catch (e) {
        console.error('Restore error:', e);
        setSyncStatus('offline');
        if (!options.skipToast) showToast('Failed to restore task');
        return false;
      }
    }

    async function ensureRecurringTask(task) {
      if (!task || !task.recurrence || task.recurrence === 'none') return false;
      const nextDate = getNextRecurringDate(task.date, task.recurrence);
      if (!nextDate) return false;

      const sourceId = task.recurringSourceId || task.id;
      try {
        const existing = await db.collection('planner_tasks')
          .where('recurringSourceId', '==', sourceId)
          .where('date', '==', nextDate)
          .get();
        if (!existing.empty) return false;

        return await addTask({
          text: task.text,
          priority: task.priority,
          category: DEFAULT_CATEGORY_ID,
          dueTime: task.dueTime || null,
          date: nextDate,
          completed: false,
          notes: task.notes || '',
          reminderDate: null,
          reminderTime: null,
          reminderFired: false,
          pinned: !!task.pinned,
          archived: false,
          recurrence: task.recurrence,
          recurringSourceId: sourceId,
          notesUpdatedAt: task.notesUpdatedAt || null,
          subtasks: normalizeSubtasks(task.subtasks).map(subtask => ({
            ...subtask,
            id: createId('subtask'),
            completed: false,
            completedAt: null
          }))
        }, { toastMessage: 'Next recurring task added' });
      } catch (e) {
        console.error('Recurring task error:', e);
        showToast('Failed to create next recurring task');
        return false;
      }
    }

    async function setTaskCompleted(task, nowCompleted = !task.completed) {
      if (!task) return { recurringTaskId: null };
      const previous = cloneTaskSnapshot(task);
      const completedAt = nowCompleted ? getCurrentTimestamp() : null;
      const success = await updateTask(task.id, { completed: nowCompleted, completedAt });
      if (!success) return { recurringTaskId: null };
      if (nowCompleted) {
        await cancelScheduledReminderNotification(task.id);
      }

      let recurringTaskId = null;
      if (nowCompleted) {
        recurringTaskId = await ensureRecurringTask(task);
      }

      queueUndoAction(nowCompleted ? 'Task completed' : 'Task reopened', async () => {
        await updateTask(task.id, getTaskRestoreFields(previous));
        if (recurringTaskId) {
          await deleteTask(recurringTaskId, { skipToast: true });
        }
      });

      return { recurringTaskId, completedAt };
    }

    async function setTaskArchived(task, archived = true) {
      if (!task) return false;
      const previous = cloneTaskSnapshot(task);
      const success = await updateTask(task.id, {
        archived,
        archivedAt: archived ? getCurrentTimestamp() : null,
        pinned: archived ? false : !!task.pinned
      });
      if (!success) return false;

      dismissReminderAlert(task.id);
      if (archived) {
        await cancelScheduledReminderNotification(task.id);
      }
      queueUndoAction(archived ? 'Task archived' : 'Task restored', async () => {
        await updateTask(task.id, getTaskRestoreFields(previous));
      });
      showToast(archived ? 'Task archived' : 'Task restored');
      return true;
    }

    async function deleteTaskWithUndo(task) {
      if (!task) return false;
      const snapshot = cloneTaskSnapshot(task);
      const success = await deleteTask(task.id, { skipToast: true });
      if (!success) return false;

      queueUndoAction('Task deleted', async () => {
        await restoreTaskSnapshot(snapshot, { skipToast: true });
      });
      showToast('Task deleted');
      return true;
    }

    async function updateTaskSubtasks(taskId, subtasks, options = {}) {
      const task = State.tasks.find(item => item.id === taskId);
      if (!task) return false;
      const previous = normalizeSubtasks(task.subtasks);
      const next = normalizeSubtasks(subtasks);
      const success = await updateTask(taskId, { subtasks: next });
      if (!success) return false;

      if (!options.skipUndo) {
        queueUndoAction('Subtasks updated', async () => {
          await updateTask(taskId, { subtasks: previous });
        });
      }
      return true;
    }

    async function toggleTaskSubtask(taskId, subtaskId) {
      const task = State.tasks.find(item => item.id === taskId);
      if (!task) return false;
      const previous = normalizeSubtasks(task.subtasks);
      const next = previous.map(subtask => {
        if (subtask.id !== subtaskId) return subtask;
        const completed = !subtask.completed;
        return {
          ...subtask,
          completed,
          completedAt: completed ? getCurrentTimestamp() : null
        };
      });
      const success = await updateTask(taskId, { subtasks: next });
      if (!success) return false;

      queueUndoAction('Subtask updated', async () => {
        await updateTask(taskId, { subtasks: previous });
      });
      return true;
    }

    /* ───────────── Contracts Module ───────────── */
    const CONTRACTS_COLLECTION = 'contracts';
    const CONTRACTS_BOARD_SETTINGS_DOC = 'contracts_board';
    const CONTRACT_ARCHIVED_COLUMN_ID = 'archived';
    const DEFAULT_CONTRACT_COLUMNS = [
      { id: 'intake', label: 'Intake', color: '#7c3aed', order: 0 },
      { id: 'reviewing', label: 'Reviewing', color: '#2563eb', order: 1 },
      { id: 'waiting-on', label: 'Waiting On', color: '#d97706', order: 2 },
      { id: 'signed', label: 'Signed', color: '#059669', order: 3 },
      { id: CONTRACT_ARCHIVED_COLUMN_ID, label: 'Archived', color: '#6b7280', order: 4 }
    ];

    function getDefaultContractBoardSettings() {
      return {
        columns: DEFAULT_CONTRACT_COLUMNS.map(column => ({ ...column })),
        tags: []
      };
    }

    function getContractsState() {
      if (!window.ContractsState) {
        window.ContractsState = {
          contracts: [],
          boardSettings: getDefaultContractBoardSettings(),
          contractsLoaded: false,
          settingsLoaded: false
        };
      }
      return window.ContractsState;
    }

    function normalizeContractFile(file) {
      if (!file) return null;
      const label = String(file.label || '').trim();
      const url = String(file.url || '').trim();
      if (!label || !url) return null;
      return {
        id: file.id || createId('contract-file'),
        label,
        url,
        type: String(file.type || '').trim(),
        note: String(file.note || '').trim(),
        addedAt: file.addedAt || getCurrentTimestamp()
      };
    }

    function normalizeContractBoardSettings(settings) {
      const defaults = getDefaultContractBoardSettings();
      const sourceColumns = Array.isArray(settings && settings.columns) ? settings.columns : defaults.columns;
      const sourceTags = Array.isArray(settings && settings.tags) ? settings.tags : [];

      const columns = sourceColumns
        .map((column, index) => {
          if (!column) return null;
          const id = String(column.id || '').trim() || createId('contract-column');
          const label = String(column.label || '').trim() || 'Untitled column';
          const fallback = defaults.columns.find(item => item.id === id);
          return {
            id,
            label,
            color: String(column.color || (fallback && fallback.color) || '#6366f1').trim(),
            order: typeof column.order === 'number' ? column.order : index
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.order - b.order);

      const archivedColumn = columns.find(column => column.id === CONTRACT_ARCHIVED_COLUMN_ID);
      const activeColumns = columns.filter(column => column.id !== CONTRACT_ARCHIVED_COLUMN_ID);
      if (!activeColumns.length) {
        defaults.columns
          .filter(column => column.id !== CONTRACT_ARCHIVED_COLUMN_ID)
          .slice(0, 1)
          .forEach(column => {
            activeColumns.push({ ...column });
          });
      }

      const normalizedColumns = activeColumns.map((column, index) => ({
        ...column,
        order: index
      }));

      normalizedColumns.push({
        ...(archivedColumn || defaults.columns.find(column => column.id === CONTRACT_ARCHIVED_COLUMN_ID)),
        id: CONTRACT_ARCHIVED_COLUMN_ID,
        order: normalizedColumns.length
      });

      const tags = sourceTags
        .map((tag, index) => {
          if (!tag) return null;
          const id = String(tag.id || '').trim() || createId('contract-tag');
          const label = String(tag.label || '').trim();
          if (!label) return null;
          return {
            id,
            label,
            color: String(tag.color || '#6366f1').trim(),
            order: typeof tag.order === 'number' ? tag.order : index
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.order - b.order)
        .map((tag, index) => ({
          id: tag.id,
          label: tag.label,
          color: tag.color,
          order: index
        }));

      return { columns: normalizedColumns, tags };
    }

    function normalizeContract(contract) {
      const fallbackSettings = normalizeContractBoardSettings(getContractsState().boardSettings);
      const firstActiveColumn = fallbackSettings.columns.find(column => column.id !== CONTRACT_ARCHIVED_COLUMN_ID);
      const requestedColumnId = String(contract && contract.columnId || '').trim();
      const archived = !!(contract && contract.archived) || requestedColumnId === CONTRACT_ARCHIVED_COLUMN_ID;
      const columnId = archived
        ? CONTRACT_ARCHIVED_COLUMN_ID
        : (requestedColumnId || (firstActiveColumn && firstActiveColumn.id) || DEFAULT_CONTRACT_COLUMNS[0].id);

      return {
        id: contract && contract.id,
        title: String(contract && contract.title || '').trim(),
        counterparty: String(contract && contract.counterparty || '').trim(),
        owner: String(contract && contract.owner || '').trim(),
        columnId,
        previousColumnId: archived
          ? (String(contract && contract.previousColumnId || '').trim() || (firstActiveColumn && firstActiveColumn.id) || DEFAULT_CONTRACT_COLUMNS[0].id)
          : columnId,
        sortOrder: typeof (contract && contract.sortOrder) === 'number' ? contract.sortOrder : 0,
        tags: Array.isArray(contract && contract.tags)
          ? [...new Set(contract.tags.map(tag => String(tag || '').trim()).filter(Boolean))]
          : [],
        effectiveDate: contract && contract.effectiveDate ? String(contract.effectiveDate) : null,
        renewalDate: contract && contract.renewalDate ? String(contract.renewalDate) : null,
        statusNote: String(contract && contract.statusNote || '').trim(),
        notes: String(contract && contract.notes || '').trim(),
        archived,
        archivedAt: archived ? ((contract && contract.archivedAt) || getCurrentTimestamp()) : null,
        createdAt: contract && contract.createdAt || null,
        updatedAt: contract && contract.updatedAt || contract && contract.createdAt || null,
        files: Array.isArray(contract && contract.files)
          ? contract.files.map(normalizeContractFile).filter(Boolean)
          : []
      };
    }

    function cloneContractSnapshot(contract) {
      return JSON.parse(JSON.stringify(contract || {}));
    }

    function getContractColumnContracts(columnId, contracts = getContractsState().contracts) {
      if (columnId === CONTRACT_ARCHIVED_COLUMN_ID) {
        return contracts.filter(contract => contract.archived).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      }
      return contracts
        .filter(contract => !contract.archived && contract.columnId === columnId)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    }

    function getNextContractSortOrder(columnId, contracts = getContractsState().contracts) {
      const columnContracts = getContractColumnContracts(columnId, contracts);
      return columnContracts.length
        ? Math.max(...columnContracts.map(contract => contract.sortOrder || 0)) + 1
        : 0;
    }

    function hideContractsLoadingIfReady() {
      const state = getContractsState();
      if (!state.contractsLoaded || !state.settingsLoaded) return;
      const loading = document.getElementById('loading');
      if (loading) loading.style.display = 'none';
    }

    function renderContractsIfAvailable() {
      if (typeof renderContracts === 'function') {
        renderContracts();
      }
    }

    function setupContractsRealtimeSync() {
      const state = getContractsState();
      setSyncStatus('syncing');

      db.collection(CONTRACTS_COLLECTION).onSnapshot(snapshot => {
        state.contracts = snapshot.docs
          .map(doc => normalizeContract({ id: doc.id, ...doc.data() }))
          .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        state.contractsLoaded = true;
        setSyncStatus('synced');
        hideContractsLoadingIfReady();
        renderContractsIfAvailable();
      }, error => {
        console.error('Contracts realtime error:', error);
        state.contractsLoaded = true;
        setSyncStatus('offline');
        hideContractsLoadingIfReady();
        showToast('Failed to load contracts');
      });

      db.collection('settings').doc(CONTRACTS_BOARD_SETTINGS_DOC).onSnapshot(doc => {
        state.boardSettings = normalizeContractBoardSettings(doc.exists ? doc.data() : null);
        state.settingsLoaded = true;
        setSyncStatus('synced');
        hideContractsLoadingIfReady();
        renderContractsIfAvailable();
      }, error => {
        console.error('Contract settings realtime error:', error);
        state.settingsLoaded = true;
        state.boardSettings = normalizeContractBoardSettings(null);
        setSyncStatus('offline');
        hideContractsLoadingIfReady();
        showToast('Failed to load contract board settings');
      });
    }

    async function addContractRecord(contract, options = {}) {
      try {
        setSyncStatus('syncing');
        const state = getContractsState();
        const timestamp = getCurrentTimestamp();
        const normalized = normalizeContract({
          ...contract,
          createdAt: contract.createdAt || timestamp,
          updatedAt: timestamp
        });
        normalized.sortOrder = getNextContractSortOrder(normalized.columnId, state.contracts);
        const { id, ...payload } = normalized;
        const docRef = await db.collection(CONTRACTS_COLLECTION).add(payload);
        setSyncStatus('synced');
        if (!options.skipToast) showToast(options.toastMessage || 'Contract added');
        return docRef.id;
      } catch (error) {
        console.error('Add contract error:', error);
        setSyncStatus('offline');
        if (!options.skipToast) showToast('Failed to add contract');
        return null;
      }
    }

    async function updateContractRecord(id, updates, options = {}) {
      try {
        setSyncStatus('syncing');
        const state = getContractsState();
        const existing = options.existingContract || state.contracts.find(contract => contract.id === id);
        if (!existing) throw new Error('Contract not found: ' + id);

        const incomingColumnId = Object.prototype.hasOwnProperty.call(updates, 'columnId')
          ? updates.columnId
          : existing.columnId;
        const incomingArchived = Object.prototype.hasOwnProperty.call(updates, 'archived')
          ? !!updates.archived
          : existing.archived;
        const nextColumnId = incomingArchived ? CONTRACT_ARCHIVED_COLUMN_ID : incomingColumnId;
        const movingColumns = nextColumnId !== (existing.archived ? CONTRACT_ARCHIVED_COLUMN_ID : existing.columnId);

        const payload = {
          ...updates,
          columnId: nextColumnId,
          archived: incomingArchived,
          updatedAt: getCurrentTimestamp()
        };

        if (incomingArchived && !existing.archived) {
          payload.archivedAt = payload.archivedAt || getCurrentTimestamp();
          payload.previousColumnId = existing.columnId;
        } else if (!incomingArchived && existing.archived) {
          payload.archivedAt = null;
          payload.previousColumnId = nextColumnId;
        } else if (!incomingArchived && nextColumnId) {
          payload.previousColumnId = nextColumnId;
        }

        if (movingColumns && !Object.prototype.hasOwnProperty.call(payload, 'sortOrder')) {
          payload.sortOrder = getNextContractSortOrder(nextColumnId, state.contracts.filter(contract => contract.id !== id));
        }

        await db.collection(CONTRACTS_COLLECTION).doc(id).update(payload);
        setSyncStatus('synced');
        if (!options.skipToast) showToast(options.toastMessage || 'Contract updated');
        return true;
      } catch (error) {
        console.error('Update contract error:', error);
        setSyncStatus('offline');
        if (!options.skipToast) showToast('Failed to update contract');
        return false;
      }
    }

    async function restoreContractSnapshot(contractSnapshot, options = {}) {
      if (!contractSnapshot || !contractSnapshot.id) return false;
      try {
        setSyncStatus('syncing');
        const { id, ...payload } = normalizeContract(contractSnapshot);
        await db.collection(CONTRACTS_COLLECTION).doc(id).set(payload);
        setSyncStatus('synced');
        if (!options.skipToast) showToast(options.toastMessage || 'Contract restored');
        return true;
      } catch (error) {
        console.error('Restore contract error:', error);
        setSyncStatus('offline');
        if (!options.skipToast) showToast('Failed to restore contract');
        return false;
      }
    }

    async function deleteContractRecord(id, options = {}) {
      try {
        setSyncStatus('syncing');
        await db.collection(CONTRACTS_COLLECTION).doc(id).delete();
        setSyncStatus('synced');
        if (!options.skipToast) showToast(options.toastMessage || 'Contract deleted');
        return true;
      } catch (error) {
        console.error('Delete contract error:', error);
        setSyncStatus('offline');
        if (!options.skipToast) showToast('Failed to delete contract');
        return false;
      }
    }

    async function deleteContractRecordWithUndo(contract) {
      if (!contract) return false;
      const snapshot = cloneContractSnapshot(contract);
      const success = await deleteContractRecord(contract.id, { skipToast: true });
      if (!success) return false;
      queueUndoAction('Contract deleted', async () => {
        await restoreContractSnapshot(snapshot, { skipToast: true });
      });
      showToast('Contract deleted');
      return true;
    }

    async function saveContractRecord(contractDraft, existingContract = null) {
      const timestamp = getCurrentTimestamp();
      const normalized = normalizeContract({
        ...contractDraft,
        updatedAt: timestamp,
        createdAt: existingContract ? existingContract.createdAt : timestamp
      });
      if (!normalized.title) {
        showToast('Add a contract title before saving');
        return null;
      }

      if (!existingContract) {
        return addContractRecord(normalized);
      }

      const payload = {
        title: normalized.title,
        counterparty: normalized.counterparty,
        owner: normalized.owner,
        columnId: normalized.columnId,
        previousColumnId: normalized.archived
          ? (existingContract.archived ? existingContract.previousColumnId : existingContract.columnId)
          : normalized.columnId,
        tags: normalized.tags,
        effectiveDate: normalized.effectiveDate,
        renewalDate: normalized.renewalDate,
        statusNote: normalized.statusNote,
        notes: normalized.notes,
        archived: normalized.archived,
        archivedAt: normalized.archived ? (existingContract.archivedAt || timestamp) : null,
        files: normalized.files
      };

      const success = await updateContractRecord(existingContract.id, payload, {
        existingContract,
        toastMessage: 'Contract saved'
      });
      return success ? existingContract.id : null;
    }

    async function moveContractRecord(contractId, targetColumnId, targetId = null, position = 'after') {
      const state = getContractsState();
      const dragged = state.contracts.find(contract => contract.id === contractId);
      if (!dragged) return false;

      const sourceColumnId = dragged.archived ? CONTRACT_ARCHIVED_COLUMN_ID : dragged.columnId;
      const nextArchived = targetColumnId === CONTRACT_ARCHIVED_COLUMN_ID;
      const nextColumnId = nextArchived ? CONTRACT_ARCHIVED_COLUMN_ID : targetColumnId;

      const sourceContracts = getContractColumnContracts(sourceColumnId, state.contracts).filter(contract => contract.id !== dragged.id);
      const targetContractsBase = sourceColumnId === nextColumnId
        ? sourceContracts.slice()
        : getContractColumnContracts(nextColumnId, state.contracts).filter(contract => contract.id !== dragged.id);

      let insertIndex = targetContractsBase.length;
      if (targetId) {
        const targetIndex = targetContractsBase.findIndex(contract => contract.id === targetId);
        if (targetIndex >= 0) {
          insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
        }
      }

      if (insertIndex < 0) insertIndex = 0;
      if (insertIndex > targetContractsBase.length) insertIndex = targetContractsBase.length;

      const draggedNext = normalizeContract({
        ...dragged,
        columnId: nextColumnId,
        archived: nextArchived,
        archivedAt: nextArchived ? (dragged.archivedAt || getCurrentTimestamp()) : null,
        previousColumnId: nextArchived ? (dragged.archived ? dragged.previousColumnId : dragged.columnId) : nextColumnId
      });

      const targetContracts = targetContractsBase.slice();
      targetContracts.splice(insertIndex, 0, draggedNext);

      try {
        setSyncStatus('syncing');
        const batch = db.batch();
        const timestamp = getCurrentTimestamp();
        const changedIds = new Set();

        targetContracts.forEach((contract, index) => {
          const nextValues = {
            columnId: nextColumnId,
            archived: nextArchived,
            archivedAt: nextArchived ? (contract.archivedAt || timestamp) : null,
            previousColumnId: nextArchived ? (contract.previousColumnId || dragged.columnId || contract.columnId) : nextColumnId,
            sortOrder: index,
            updatedAt: timestamp
          };
          const currentColumnId = contract.archived ? CONTRACT_ARCHIVED_COLUMN_ID : contract.columnId;
          if (
            currentColumnId !== nextColumnId ||
            contract.archived !== nextArchived ||
            (contract.sortOrder || 0) !== index ||
            (nextArchived && !contract.archivedAt) ||
            (!nextArchived && contract.archivedAt)
          ) {
            changedIds.add(contract.id);
            batch.update(db.collection(CONTRACTS_COLLECTION).doc(contract.id), nextValues);
          }
        });

        if (sourceColumnId !== nextColumnId) {
          sourceContracts.forEach((contract, index) => {
            if ((contract.sortOrder || 0) === index) return;
            changedIds.add(contract.id);
            batch.update(db.collection(CONTRACTS_COLLECTION).doc(contract.id), {
              sortOrder: index,
              updatedAt: timestamp
            });
          });
        }

        if (!changedIds.size) {
          setSyncStatus('synced');
          return true;
        }

        await batch.commit();
        setSyncStatus('synced');
        return true;
      } catch (error) {
        console.error('Move contract error:', error);
        setSyncStatus('offline');
        showToast('Failed to move contract');
        return false;
      }
    }

    async function saveContractBoardSettings(settings, options = {}) {
      try {
        setSyncStatus('syncing');
        const normalized = normalizeContractBoardSettings(settings);
        await db.collection('settings').doc(CONTRACTS_BOARD_SETTINGS_DOC).set(normalized);
        setSyncStatus('synced');
        if (!options.skipToast) showToast(options.toastMessage || 'Board settings saved');
        return true;
      } catch (error) {
        console.error('Save contract board settings error:', error);
        setSyncStatus('offline');
        if (!options.skipToast) showToast('Failed to save board settings');
        return false;
      }
    }

    let scheduledReminderSyncTimer = null;

    function queueScheduledReminderSync() {
      clearTimeout(scheduledReminderSyncTimer);
      scheduledReminderSyncTimer = setTimeout(() => {
        syncScheduledReminderNotifications().catch(error => {
          console.error('Scheduled reminder sync error:', error);
        });
      }, 200);
    }

    function setupRealtimeSync() {
      setSyncStatus('syncing');
      db.collection('planner_tasks').onSnapshot(snapshot => {
        State.tasks = snapshot.docs.map(doc => normalizeTask({ id: doc.id, ...doc.data() }));
        State.activeReminderAlerts = State.activeReminderAlerts.filter(alert => {
          const task = State.tasks.find(item => item.id === alert.taskId);
          return !!task && !task.completed && !task.archived;
        });
        setSyncStatus('synced');
        document.getElementById('loading').style.display = 'none';
        render();
        queueScheduledReminderSync();
      }, err => {
        console.error('Realtime error:', err);
        setSyncStatus('offline');
        document.getElementById('loading').style.display = 'none';
        showToast('Failed to load tasks');
      });
    }

    async function requestNotificationPermissionIfNeeded() {
      if (!('Notification' in window)) return 'unsupported';
      await registerPlannerServiceWorker();
      if (Notification.permission === 'default') {
        const result = await Notification.requestPermission();
        if (result === 'granted') {
          queueScheduledReminderSync();
        }
        return result;
      }
      if (Notification.permission === 'granted') {
        queueScheduledReminderSync();
      }
      return Notification.permission;
    }

    async function showReminderAlert(task) {
      const body = buildReminderNotificationBody(task);
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          await showTaskNotification(task, {
            body,
            tag: 'planner-live-reminder-' + task.id
          });
        } catch (error) {
          console.error('Notification display error:', error);
        }
      }
      showToast('Reminder: ' + task.text);
      upsertReminderAlert(task);
    }

    async function snoozeReminder(taskId, mode) {
      const task = State.tasks.find(item => item.id === taskId);
      if (!task) {
        dismissReminderAlert(taskId);
        showToast('Task could not be found');
        return;
      }

      const previous = cloneTaskSnapshot(task);
      const nextReminder = getSnoozeDateTime(mode);
      await updateTask(taskId, {
        reminderDate: nextReminder.date,
        reminderTime: nextReminder.time,
        reminderFired: false,
        reminderFiredAt: null
      });
      dismissReminderAlert(taskId);
      queueUndoAction(mode === 'tomorrow' ? 'Reminder snoozed until tomorrow' : 'Reminder snoozed', async () => {
        await updateTask(taskId, {
          reminderDate: previous.reminderDate || null,
          reminderTime: previous.reminderTime || null,
          reminderFired: !!previous.reminderFired,
          reminderFiredAt: previous.reminderFiredAt || null
        });
      });
      showToast(mode === 'tomorrow' ? 'Reminder snoozed until tomorrow' : 'Reminder snoozed');
    }

    async function triggerReminderIfDue(task) {
      const reminderAt = getReminderDateTime(task);
      if (!reminderAt || reminderAt.getTime() > Date.now() || task.completed || task.reminderFired) return false;
      try {
        let latestTask = task;
        const claimed = await db.runTransaction(async tx => {
          const ref = db.collection('planner_tasks').doc(task.id);
          const snapshot = await tx.get(ref);
          if (!snapshot.exists) return false;
          const latest = normalizeTask({ id: snapshot.id, ...snapshot.data() });
          latestTask = latest;
          const latestReminderAt = getReminderDateTime(latest);
          if (!latestReminderAt || latestReminderAt.getTime() > Date.now() || latest.completed || latest.reminderFired) {
            return false;
          }
          tx.update(ref, {
            reminderFired: true,
            reminderFiredAt: new Date().toISOString()
          });
          return true;
        });

        if (!claimed) return false;
        await cancelScheduledReminderNotification(latestTask.id);
        await showReminderAlert(latestTask);
        return true;
      } catch (e) {
        console.error('Reminder error:', e);
        return false;
      }
    }

    async function checkDueReminders() {
      const dueTasks = State.tasks.filter(task => !task.archived && !task.completed && !task.reminderFired && getReminderDateTime(task));
      for (const task of dueTasks) {
        await triggerReminderIfDue(task);
      }
    }

    function startReminderPolling() {
      if (reminderTimer) clearInterval(reminderTimer);
      checkDueReminders();
      reminderTimer = setInterval(checkDueReminders, REMINDER_POLL_INTERVAL_MS);
    }
