    /* ───────────── Reminder Jobs + Push Delivery ───────────── */
    const PUSH_REGISTRATIONS_COLLECTION = 'push_registrations';
    const REMINDER_JOBS_COLLECTION = 'reminder_jobs';
    let reminderJobsSyncInitialized = false;
    let pushRegistrationSyncInitialized = false;
    let foregroundMessagingBound = false;
    let reminderBackfillTimer = null;

    function shouldSyncReminderForTaskUpdates(updates) {
      return [
        'text',
        'dueTime',
        'reminderDate',
        'reminderTime',
        'reminderFired',
        'reminderFiredAt',
        'completed',
        'archived'
      ].some(field => Object.prototype.hasOwnProperty.call(updates || {}, field));
    }

    function normalizeReminderJobRecord(job) {
      return normalizeReminderJob(job);
    }

    function getReminderJobStatusForTask(task, options = {}) {
      if (!task || !task.reminderDate || !task.reminderTime || task.completed || task.archived) {
        return options.status || 'cancelled';
      }
      if (options.status) return options.status;
      if (task.reminderFired) return 'sent';
      return 'pending';
    }

    function buildReminderJobPayload(task, options = {}) {
      const scheduledAt = getReminderDateTime(task);
      const timestamp = getCurrentTimestamp();
      const nextStatus = getReminderJobStatusForTask(task, options);
      return {
        taskId: task.id,
        taskText: stripHashtags(task.text || ''),
        scheduledFor: scheduledAt ? scheduledAt.toISOString() : null,
        dueTime: task.dueTime || null,
        status: nextStatus,
        attemptCount: typeof options.attemptCount === 'number'
          ? options.attemptCount
          : ((getReminderJob(task.id) && getReminderJob(task.id).attemptCount) || 0),
        sentAt: options.sentAt || (task.reminderFired ? (task.reminderFiredAt || timestamp) : null),
        lastAttemptAt: options.lastAttemptAt || ((getReminderJob(task.id) && getReminderJob(task.id).lastAttemptAt) || null),
        clickUrl: 'planner.html#task=' + encodeURIComponent(task.id),
        createdAt: (getReminderJob(task.id) && getReminderJob(task.id).createdAt) || timestamp,
        updatedAt: timestamp
      };
    }

    async function setReminderJob(task, options = {}) {
      if (!task || !task.id) return;
      const ref = db.collection(REMINDER_JOBS_COLLECTION).doc(task.id);
      const existing = getReminderJob(task.id);
      const payload = buildReminderJobPayload(task, options);
      if (!payload.scheduledFor || payload.status === 'cancelled') {
        if (!existing && !task.reminderDate && !task.reminderTime) {
          return;
        }
        await ref.set({
          taskId: task.id,
          taskText: stripHashtags(task.text || ''),
          scheduledFor: null,
          dueTime: task.dueTime || null,
          status: 'cancelled',
          attemptCount: 0,
          sentAt: null,
          lastAttemptAt: options.lastAttemptAt || null,
          clickUrl: 'planner.html#task=' + encodeURIComponent(task.id),
          updatedAt: getCurrentTimestamp()
        }, { merge: true });
        return;
      }
      await ref.set(payload, { merge: true });
    }

    async function deleteReminderJob(taskId) {
      if (!taskId) return;
      try {
        await db.collection(REMINDER_JOBS_COLLECTION).doc(taskId).delete();
      } catch (error) {
        console.error('Delete reminder job error:', error);
      }
    }

    async function syncReminderJobForTask(task, options = {}) {
      if (!task || !task.id) return;
      try {
        await setReminderJob(task, options);
      } catch (error) {
        console.error('Sync reminder job error:', error);
      }
    }

    function getPushRegistrationDefaults(overrides = {}) {
      const now = getCurrentTimestamp();
      return {
        token: null,
        enabled: false,
        browserFamily: getBrowserFamily(),
        supportsPush: supportsPushRegistration(),
        supportsScheduledNotifications: supportsNotificationTriggers(),
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
        ...overrides
      };
    }

    async function savePushRegistrationDoc(overrides = {}) {
      const installId = State.pushInstallId || getPlannerInstallId();
      const existing = State.pushRegistration || {};
      const payload = {
        ...getPushRegistrationDefaults(),
        ...existing,
        ...overrides,
        browserFamily: getBrowserFamily(),
        supportsPush: supportsPushRegistration(),
        supportsScheduledNotifications: supportsNotificationTriggers(),
        lastSeenAt: getCurrentTimestamp(),
        updatedAt: getCurrentTimestamp(),
        createdAt: existing.createdAt || getCurrentTimestamp()
      };
      await db.collection(PUSH_REGISTRATIONS_COLLECTION).doc(installId).set(payload, { merge: true });
      State.pushRegistration = { id: installId, ...payload };
    }

    function bindForegroundMessaging(registration) {
      if (foregroundMessagingBound || typeof firebase.messaging !== 'function') return;
      let messaging = null;
      try {
        messaging = firebase.messaging();
      } catch (error) {
        console.error('Messaging init error:', error);
        return;
      }
      if (!messaging || typeof messaging.onMessage !== 'function') return;
      foregroundMessagingBound = true;
      messaging.onMessage(payload => {
        const taskId = payload && payload.data ? payload.data.taskId : null;
        const task = taskId ? State.tasks.find(item => item.id === taskId) : null;
        if (!task) return;
        showToast('Reminder: ' + task.text);
        upsertReminderAlert(task);
      });
    }

    async function ensurePushRegistration(options = {}) {
      try {
        if (typeof window === 'undefined') return getReminderDeliveryStatus();

        const status = getReminderDeliveryStatus();
        const registration = await registerPlannerServiceWorker();
        if (registration) bindForegroundMessaging(registration);

        if (status.key === 'blocked') {
          await savePushRegistrationDoc({
            token: null,
            enabled: false
          });
          return status;
        }

        if (!supportsPushRegistration() || typeof firebase.messaging !== 'function') {
          await savePushRegistrationDoc({
            token: null,
            enabled: false
          });
          return getReminderDeliveryStatus();
        }

        if (Notification.permission !== 'granted') {
          await savePushRegistrationDoc({
            token: null,
            enabled: false
          });
          return getReminderDeliveryStatus();
        }

        const messaging = firebase.messaging();
        const token = await messaging.getToken({
          vapidKey: PLANNER_PUSH_CONFIG.vapidKey,
          serviceWorkerRegistration: registration
        });

        if (!token) {
          await savePushRegistrationDoc({
            token: null,
            enabled: false
          });
          return getReminderDeliveryStatus();
        }

        await savePushRegistrationDoc({
          token,
          enabled: true
        });
      } catch (error) {
        console.error('Push registration error:', error);
        try {
          await savePushRegistrationDoc({
            token: null,
            enabled: false
          });
        } catch (saveError) {
          console.error('Push fallback registration error:', saveError);
        }
        if (!options.quiet) {
          showToast('Push setup fell back to in-browser reminders on this device.');
        }
      }

      queueScheduledReminderSync();
      return getReminderDeliveryStatus();
    }

    function setupReminderJobsRealtimeSync() {
      if (reminderJobsSyncInitialized) return;
      reminderJobsSyncInitialized = true;
      db.collection(REMINDER_JOBS_COLLECTION).onSnapshot(snapshot => {
        State.reminderJobs = snapshot.docs
          .map(doc => normalizeReminderJobRecord({ id: doc.id, ...doc.data() }))
          .filter(Boolean)
          .sort((a, b) => {
            const aTime = getReminderJobDateTime(a)?.getTime() || Number.POSITIVE_INFINITY;
            const bTime = getReminderJobDateTime(b)?.getTime() || Number.POSITIVE_INFINITY;
            return aTime - bTime;
          });
        render();
      }, error => {
        console.error('Reminder jobs realtime error:', error);
      });
    }

    function setupPushRegistrationRealtimeSync() {
      if (pushRegistrationSyncInitialized) return;
      pushRegistrationSyncInitialized = true;
      const installId = State.pushInstallId || getPlannerInstallId();
      db.collection(PUSH_REGISTRATIONS_COLLECTION).doc(installId).onSnapshot(doc => {
        State.pushRegistration = doc.exists ? { id: doc.id, ...doc.data() } : null;
        render();
      }, error => {
        console.error('Push registration realtime error:', error);
      });
    }

    function setupReminderInfrastructure() {
      setupReminderJobsRealtimeSync();
      setupPushRegistrationRealtimeSync();
      ensurePushRegistration({ quiet: true }).catch(error => {
        console.error('Push registration sync error:', error);
      });
    }

    function reminderJobNeedsBackfill(task) {
      const job = getReminderJob(task.id);
      const reminderAt = getReminderDateTime(task);
      if (!reminderAt) return !!job;
      if (!job) return true;
      const jobAt = getReminderJobDateTime(job);
      if (!jobAt) return true;
      if (jobAt.toISOString() !== reminderAt.toISOString()) return true;
      if ((task.completed || task.archived) && job.status !== 'cancelled') return true;
      if (!task.completed && !task.archived && task.reminderFired && job.status !== 'sent') return true;
      if (!task.completed && !task.archived && !task.reminderFired && job.status === 'cancelled') return true;
      return false;
    }

    function queueReminderJobBackfill() {
      clearTimeout(reminderBackfillTimer);
      reminderBackfillTimer = setTimeout(async () => {
        const candidates = State.tasks.filter(reminderJobNeedsBackfill);
        for (const task of candidates) {
          await syncReminderJobForTask(task);
        }
      }, 400);
    }

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
        await syncReminderJobForTask({ id: docRef.id, ...task });
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
        const existing = State.tasks.find(task => task.id === id);
        const merged = existing ? normalizeTask({ ...existing, ...updates, id }) : null;
        await db.collection('planner_tasks').doc(id).update({
          ...updates,
          updatedAt: getCurrentTimestamp()
        });
        if (merged && shouldSyncReminderForTaskUpdates(updates)) {
          await syncReminderJobForTask(merged);
        }
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
        await deleteReminderJob(id);
        await cancelScheduledReminderNotification(id);
        dismissReminderAlert(id);
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
        await syncReminderJobForTask({ id, ...taskData });
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
    const CONTRACTS_VIEWS_SETTINGS_DOC = 'contracts_views';
    const CONTRACT_ARCHIVED_COLUMN_ID = 'archived';
    const CONTRACT_ACTIVITY_LIMIT = 50;
    const DEFAULT_CONTRACT_COLUMNS = [
      { id: 'intake', label: 'Intake', color: '#7c3aed', order: 0 },
      { id: 'reviewing', label: 'Reviewing', color: '#2563eb', order: 1 },
      { id: 'waiting-on', label: 'Waiting On', color: '#d97706', order: 2 },
      { id: 'signed', label: 'Signed', color: '#059669', order: 3 },
      { id: CONTRACT_ARCHIVED_COLUMN_ID, label: 'Archived', color: '#6b7280', order: 4 }
    ];
    const DEFAULT_CONTRACT_RISK_LEVELS = [
      { id: 'low', label: 'Low', color: '#10b981', order: 0 },
      { id: 'medium', label: 'Medium', color: '#f59e0b', order: 1 },
      { id: 'high', label: 'High', color: '#ef4444', order: 2 }
    ];
    const DEFAULT_CONTRACT_FILE_TYPES = [
      { id: 'agreement', label: 'Agreement', color: '#4f46e5', order: 0 },
      { id: 'amendment', label: 'Amendment', color: '#0f766e', order: 1 },
      { id: 'schedule', label: 'Schedule', color: '#d97706', order: 2 },
      { id: 'reference', label: 'Reference', color: '#64748b', order: 3 }
    ];
    const DEFAULT_CONTRACT_FILE_GROUPS = ['primary', 'amendments', 'schedules', 'reference'];
    const DEFAULT_CONTRACT_SAVED_VIEWS = [
      {
        id: 'all',
        label: 'All active',
        builtin: true,
        filters: { archived: 'active' },
        sort: 'board'
      },
      {
        id: 'renewals-soon',
        label: 'Renewals soon',
        builtin: true,
        filters: { archived: 'active', renewalWithinDays: 30 },
        sort: 'renewal'
      },
      {
        id: 'waiting-on',
        label: 'Waiting on',
        builtin: true,
        filters: { archived: 'active', waiting: true },
        sort: 'updated'
      },
      {
        id: 'my-contracts',
        label: 'My contracts',
        builtin: true,
        filters: { archived: 'active', owner: 'preferred' },
        sort: 'updated'
      },
      {
        id: 'no-files',
        label: 'No files',
        builtin: true,
        filters: { archived: 'active', noFiles: true },
        sort: 'updated'
      },
      {
        id: 'recently-updated',
        label: 'Recently updated',
        builtin: true,
        filters: { archived: 'all' },
        sort: 'updated'
      }
    ];

    function getDefaultContractBoardSettings() {
      return {
        columns: DEFAULT_CONTRACT_COLUMNS.map(column => ({ ...column })),
        tags: [],
        owners: [],
        departments: [],
        riskLevels: DEFAULT_CONTRACT_RISK_LEVELS.map(level => ({ ...level })),
        fileTypes: DEFAULT_CONTRACT_FILE_TYPES.map(type => ({ ...type }))
      };
    }

    function getDefaultContractSavedViews() {
      return DEFAULT_CONTRACT_SAVED_VIEWS.map(view => cloneContractSnapshot(view));
    }

    function getContractsState() {
      if (!window.ContractsState) {
        window.ContractsState = {
          contracts: [],
          boardSettings: getDefaultContractBoardSettings(),
          savedViews: getDefaultContractSavedViews(),
          contractsLoaded: false,
          settingsLoaded: false,
          viewsLoaded: false
        };
      }
      return window.ContractsState;
    }

    function normalizeContractLibraryItems(items, defaults, fallbackPrefix) {
      const source = Array.isArray(items) && items.length ? items : (defaults || []);
      return source
        .map((item, index) => {
          if (!item) return null;
          const id = String(item.id || '').trim() || createId(fallbackPrefix || 'contract-lib');
          const label = String(item.label || '').trim();
          if (!label) return null;
          return {
            id,
            label,
            color: String(item.color || '#6366f1').trim(),
            order: typeof item.order === 'number' ? item.order : index
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.order - b.order)
        .map((item, index) => ({
          ...item,
          order: index
        }));
    }

    function normalizeContractFile(file) {
      if (!file) return null;
      const label = String(file.label || '').trim();
      const url = String(file.url || '').trim();
      if (!label || !url) return null;
      const timestamp = getCurrentTimestamp();
      return {
        id: file.id || createId('contract-file'),
        label,
        url,
        type: String(file.type || '').trim(),
        version: String(file.version || '').trim(),
        owner: String(file.owner || '').trim(),
        group: file.isPrimary ? 'primary' : (DEFAULT_CONTRACT_FILE_GROUPS.includes(file.group) ? file.group : 'reference'),
        note: String(file.note || '').trim(),
        isPrimary: !!file.isPrimary,
        addedAt: file.addedAt || file.dateAdded || timestamp,
        dateAdded: file.dateAdded || file.addedAt || timestamp,
        dateUpdated: file.dateUpdated || file.updatedAt || file.addedAt || file.dateAdded || timestamp
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

      const tags = normalizeContractLibraryItems(sourceTags, [], 'contract-tag');
      const owners = normalizeContractLibraryItems(settings && settings.owners, defaults.owners, 'contract-owner');
      const departments = normalizeContractLibraryItems(settings && settings.departments, defaults.departments, 'contract-department');
      const riskLevels = normalizeContractLibraryItems(settings && settings.riskLevels, defaults.riskLevels, 'contract-risk');
      const fileTypes = normalizeContractLibraryItems(settings && settings.fileTypes, defaults.fileTypes, 'contract-file-type');

      return { columns: normalizedColumns, tags, owners, departments, riskLevels, fileTypes };
    }

    function normalizeContractSavedViews(settings) {
      const defaults = getDefaultContractSavedViews();
      const sourceViews = Array.isArray(settings && settings.views) ? settings.views : defaults;
      const views = sourceViews
        .map((view, index) => {
          if (!view) return null;
          const id = String(view.id || '').trim() || createId('contract-view');
          const label = String(view.label || '').trim();
          if (!label) return null;
          return {
            id,
            label,
            builtin: !!view.builtin,
            filters: view.filters && typeof view.filters === 'object' ? { ...view.filters } : {},
            sort: String(view.sort || 'board').trim(),
            order: typeof view.order === 'number' ? view.order : index
          };
        })
        .filter(Boolean);

      const byId = new Map();
      defaults.forEach((view, index) => byId.set(view.id, { ...view, order: index }));
      views.forEach(view => byId.set(view.id, view));
      return Array.from(byId.values())
        .sort((a, b) => a.order - b.order)
        .map((view, index) => ({
          ...view,
          order: index
        }));
    }

    function normalizeContractActivity(activity) {
      if (!Array.isArray(activity)) return [];
      return activity
        .map((entry, index) => {
          if (!entry) return null;
          const type = String(entry.type || '').trim();
          const label = String(entry.label || '').trim();
          if (!type || !label) return null;
          return {
            id: entry.id || createId('contract-activity'),
            type,
            label,
            at: entry.at || entry.createdAt || getCurrentTimestamp(),
            meta: entry.meta && typeof entry.meta === 'object' ? { ...entry.meta } : {},
            order: typeof entry.order === 'number' ? entry.order : index
          };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
        .slice(0, CONTRACT_ACTIVITY_LIMIT);
    }

    function createContractActivityEvent(type, label, meta = {}) {
      return {
        id: createId('contract-activity'),
        type,
        label,
        at: getCurrentTimestamp(),
        meta
      };
    }

    function appendContractActivityEvents(activity, events) {
      const normalizedEvents = (Array.isArray(events) ? events : [events])
        .filter(Boolean)
        .map(event => ({
          ...event,
          id: event.id || createId('contract-activity'),
          at: event.at || getCurrentTimestamp(),
          meta: event.meta && typeof event.meta === 'object' ? { ...event.meta } : {}
        }));
      return normalizedEvents
        .concat(normalizeContractActivity(activity))
        .slice(0, CONTRACT_ACTIVITY_LIMIT);
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
        contractValue: String(contract && contract.contractValue || '').trim(),
        department: String(contract && contract.department || '').trim(),
        contactName: String(contract && contract.contactName || '').trim(),
        contactEmail: String(contract && contract.contactEmail || '').trim(),
        riskLevel: String(contract && contract.riskLevel || '').trim(),
        reviewDeadline: contract && contract.reviewDeadline ? String(contract.reviewDeadline) : null,
        signatureDate: contract && contract.signatureDate ? String(contract.signatureDate) : null,
        nextAction: String(contract && contract.nextAction || '').trim(),
        nextActionDate: contract && contract.nextActionDate ? String(contract.nextActionDate) : null,
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
          : [],
        activity: normalizeContractActivity(contract && contract.activity)
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
      if (!state.contractsLoaded || !state.settingsLoaded || !state.viewsLoaded) return;
      const loading = document.getElementById('loading');
      if (loading) loading.style.display = 'none';
    }

    function renderContractsIfAvailable() {
      if (typeof renderContracts === 'function') {
        renderContracts();
      } else if (typeof render === 'function') {
        render();
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

      db.collection('settings').doc(CONTRACTS_VIEWS_SETTINGS_DOC).onSnapshot(doc => {
        state.savedViews = normalizeContractSavedViews(doc.exists ? doc.data() : null);
        state.viewsLoaded = true;
        setSyncStatus('synced');
        hideContractsLoadingIfReady();
        renderContractsIfAvailable();
      }, error => {
        console.error('Contract views realtime error:', error);
        state.viewsLoaded = true;
        state.savedViews = normalizeContractSavedViews(null);
        setSyncStatus('offline');
        hideContractsLoadingIfReady();
        showToast('Failed to load contract views');
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
          updatedAt: timestamp,
          activity: appendContractActivityEvents(contract.activity, createContractActivityEvent('created', 'Contract created'))
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
      if (!normalized.counterparty) {
        showToast('Add a counterparty before saving');
        return null;
      }
      if (!normalized.owner) {
        showToast('Add an owner before saving');
        return null;
      }
      if (!normalized.columnId) {
        showToast('Choose a workflow column before saving');
        return null;
      }

      if (!existingContract) {
        return addContractRecord(normalized);
      }

      const events = [];
      const settings = normalizeContractBoardSettings(getContractsState().boardSettings);
      const nextColumn = settings.columns.find(column => column.id === normalized.columnId);
      const previousColumnId = existingContract.archived ? CONTRACT_ARCHIVED_COLUMN_ID : existingContract.columnId;
      if (normalized.columnId !== previousColumnId || normalized.archived !== existingContract.archived) {
        if (normalized.archived && !existingContract.archived) {
          events.push(createContractActivityEvent('archived', 'Contract archived'));
        } else if (!normalized.archived && existingContract.archived) {
          events.push(createContractActivityEvent('restored', 'Contract restored'));
        } else {
          events.push(createContractActivityEvent('moved', 'Moved to ' + ((nextColumn && nextColumn.label) || normalized.columnId), {
            from: previousColumnId,
            to: normalized.columnId
          }));
        }
      }
      if ((normalized.renewalDate || '') !== (existingContract.renewalDate || '')) {
        events.push(createContractActivityEvent('renewal-changed', 'Renewal changed to ' + (normalized.renewalDate || 'none'), {
          from: existingContract.renewalDate || null,
          to: normalized.renewalDate || null
        }));
      }
      const existingFileIds = new Set((existingContract.files || []).map(file => file.id));
      const nextFileIds = new Set((normalized.files || []).map(file => file.id));
      normalized.files.forEach(file => {
        if (!existingFileIds.has(file.id)) {
          events.push(createContractActivityEvent('file-added', 'File added: ' + file.label, { fileId: file.id }));
        }
      });
      (existingContract.files || []).forEach(file => {
        if (!nextFileIds.has(file.id)) {
          events.push(createContractActivityEvent('file-removed', 'File removed: ' + file.label, { fileId: file.id }));
        }
      });

      const payload = {
        title: normalized.title,
        counterparty: normalized.counterparty,
        owner: normalized.owner,
        columnId: normalized.columnId,
        previousColumnId: normalized.archived
          ? (existingContract.archived ? existingContract.previousColumnId : existingContract.columnId)
          : normalized.columnId,
        tags: normalized.tags,
        contractValue: normalized.contractValue,
        department: normalized.department,
        contactName: normalized.contactName,
        contactEmail: normalized.contactEmail,
        riskLevel: normalized.riskLevel,
        reviewDeadline: normalized.reviewDeadline,
        signatureDate: normalized.signatureDate,
        nextAction: normalized.nextAction,
        nextActionDate: normalized.nextActionDate,
        effectiveDate: normalized.effectiveDate,
        renewalDate: normalized.renewalDate,
        statusNote: normalized.statusNote,
        notes: normalized.notes,
        archived: normalized.archived,
        archivedAt: normalized.archived ? (existingContract.archivedAt || timestamp) : null,
        files: normalized.files,
        activity: appendContractActivityEvents(existingContract.activity, events)
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
          const isDraggedContract = contract.id === dragged.id;
          const nextValues = {
            columnId: nextColumnId,
            archived: nextArchived,
            archivedAt: nextArchived ? (contract.archivedAt || timestamp) : null,
            previousColumnId: nextArchived ? (contract.previousColumnId || dragged.columnId || contract.columnId) : nextColumnId,
            sortOrder: index,
            updatedAt: timestamp
          };
          if (isDraggedContract && (sourceColumnId !== nextColumnId || dragged.archived !== nextArchived)) {
            const settings = normalizeContractBoardSettings(state.boardSettings);
            const nextColumn = settings.columns.find(column => column.id === nextColumnId);
            let eventType = 'moved';
            let label = 'Moved to ' + ((nextColumn && nextColumn.label) || nextColumnId);
            if (nextArchived && !dragged.archived) {
              eventType = 'archived';
              label = 'Contract archived';
            } else if (!nextArchived && dragged.archived) {
              eventType = 'restored';
              label = 'Contract restored';
            }
            nextValues.activity = appendContractActivityEvents(dragged.activity, createContractActivityEvent(eventType, label, {
              from: sourceColumnId,
              to: nextColumnId
            }));
          }
          const currentColumnId = isDraggedContract ? sourceColumnId : (contract.archived ? CONTRACT_ARCHIVED_COLUMN_ID : contract.columnId);
          if (
            (isDraggedContract && (sourceColumnId !== nextColumnId || dragged.archived !== nextArchived)) ||
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

    async function saveContractSavedViews(views, options = {}) {
      try {
        setSyncStatus('syncing');
        const normalized = normalizeContractSavedViews({ views });
        await db.collection('settings').doc(CONTRACTS_VIEWS_SETTINGS_DOC).set({ views: normalized });
        setSyncStatus('synced');
        if (!options.skipToast) showToast(options.toastMessage || 'Contract views saved');
        return true;
      } catch (error) {
        console.error('Save contract views error:', error);
        setSyncStatus('offline');
        if (!options.skipToast) showToast('Failed to save contract views');
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
      setupReminderInfrastructure();
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
        queueReminderJobBackfill();
      }, err => {
        console.error('Realtime error:', err);
        setSyncStatus('offline');
        document.getElementById('loading').style.display = 'none';
        showToast('Failed to load tasks');
      });
    }

    async function requestNotificationPermissionIfNeeded() {
      if (!('Notification' in window)) {
        if (typeof refreshReminderSupportUi === 'function') refreshReminderSupportUi();
        return 'unsupported';
      }
      await registerPlannerServiceWorker();
      if (Notification.permission === 'default') {
        const result = await Notification.requestPermission();
        if (result === 'granted') {
          await ensurePushRegistration({ quiet: true });
          queueScheduledReminderSync();
        }
        if (typeof refreshReminderSupportUi === 'function') refreshReminderSupportUi();
        return result;
      }
      if (Notification.permission === 'granted') {
        await ensurePushRegistration({ quiet: true });
        queueScheduledReminderSync();
      }
      if (typeof refreshReminderSupportUi === 'function') refreshReminderSupportUi();
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
      await syncReminderJobForTask({
        ...task,
        reminderDate: nextReminder.date,
        reminderTime: nextReminder.time,
        reminderFired: false,
        reminderFiredAt: null
      }, { status: 'snoozed' });
      dismissReminderAlert(taskId);
      queueUndoAction(mode === 'tomorrow' || mode === 'tomorrow-9' ? 'Reminder snoozed until tomorrow' : 'Reminder snoozed', async () => {
        await updateTask(taskId, {
          reminderDate: previous.reminderDate || null,
          reminderTime: previous.reminderTime || null,
          reminderFired: !!previous.reminderFired,
          reminderFiredAt: previous.reminderFiredAt || null
        });
      });
      showToast(mode === 'tomorrow' || mode === 'tomorrow-9' ? 'Reminder snoozed until tomorrow' : 'Reminder snoozed');
    }

    async function triggerReminderIfDue(task) {
      const reminderAt = getTaskReminderDateTime(task);
      if (!reminderAt || reminderAt.getTime() > Date.now() || task.completed || task.reminderFired) return false;
      try {
        let latestTask = task;
        const claimed = await db.runTransaction(async tx => {
          const ref = db.collection('planner_tasks').doc(task.id);
          const snapshot = await tx.get(ref);
          if (!snapshot.exists) return false;
          const latest = normalizeTask({ id: snapshot.id, ...snapshot.data() });
          latestTask = latest;
          const latestReminderAt = getTaskReminderDateTime(latest);
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
        await syncReminderJobForTask({
          ...latestTask,
          reminderFired: true,
          reminderFiredAt: new Date().toISOString()
        }, {
          status: 'sent',
          sentAt: new Date().toISOString(),
          lastAttemptAt: new Date().toISOString()
        });
        await cancelScheduledReminderNotification(latestTask.id);
        await showReminderAlert(latestTask);
        return true;
      } catch (e) {
        console.error('Reminder error:', e);
        return false;
      }
    }

    async function checkDueReminders() {
      if (getReminderDeliveryStatus().key === 'push') return;
      const dueTasks = State.tasks.filter(task => !task.archived && !task.completed && !task.reminderFired && getTaskReminderDateTime(task));
      for (const task of dueTasks) {
        await triggerReminderIfDue(task);
      }
    }

    function startReminderPolling() {
      if (reminderTimer) clearInterval(reminderTimer);
      checkDueReminders();
      reminderTimer = setInterval(checkDueReminders, REMINDER_POLL_INTERVAL_MS);
    }
