import { ApiError } from "./database.mjs";

function now() {
  return new Date().toISOString();
}

function parseJson(value, fallback = null) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function uniqueLabels(issues) {
  return [...new Set(issues.flatMap((issue) => Array.isArray(issue.labels) ? issue.labels : []))];
}

function projectRefMap(sqlite) {
  return new Map(sqlite.prepare(`
    SELECT project_id, external_origin, external_id, native_ref
    FROM linear_project_refs
  `).all().map((row) => [row.project_id, row]));
}

function taskRefMap(sqlite, ids) {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(", ");
  return new Map(sqlite.prepare(`
    SELECT task_id, external_origin, issue_id, native_ref, dependencies_complete
    FROM linear_task_refs
    WHERE task_id IN (${placeholders})
  `).all(...ids).map((row) => [row.task_id, row]));
}

function dependencyMap(sqlite, ids) {
  const result = new Map(ids.map((id) => [id, []]));
  if (ids.length === 0) return result;
  const placeholders = ids.map(() => "?").join(", ");
  const rows = sqlite.prepare(`
    SELECT
      task_id,
      blocker_issue_id,
      blocker_identifier,
      blocker_title,
      blocker_url,
      blocker_state_id,
      blocker_state_type,
      blocker_state_name,
      blocker_status,
      blocker_team_id,
      blocker_team_key,
      blocker_project_id,
      blocker_project_name,
      blocker_task_id,
      resolved
    FROM linear_dependency_refs
    WHERE task_id IN (${placeholders})
    ORDER BY blocker_identifier, blocker_issue_id
  `).all(...ids);
  for (const row of rows) result.get(row.task_id)?.push(row);
  return result;
}

function decorateProject(project, ref) {
  if (!project || !ref) return project;
  return {
    ...project,
    source: "linear",
    externalOrigin: ref.external_origin,
    externalId: ref.external_id ?? null,
    nativeRef: parseJson(ref.native_ref, null),
  };
}

function decorateTask(task, ref, dependencyRows = []) {
  if (!task || !ref) return task;
  const blockedBy = dependencyRows.map((row) => ({
    issueId: row.blocker_issue_id,
    identifier: row.blocker_identifier,
    title: row.blocker_title,
    url: row.blocker_url,
    stateId: row.blocker_state_id,
    stateType: row.blocker_state_type,
    stateName: row.blocker_state_name,
    status: row.blocker_status,
    teamId: row.blocker_team_id,
    teamKey: row.blocker_team_key,
    projectId: row.blocker_project_id,
    projectName: row.blocker_project_name,
    taskId: row.blocker_task_id,
    resolved: row.resolved === 1,
  }));
  const unresolvedCount = blockedBy.filter((dependency) => !dependency.resolved).length;
  const complete = ref.dependencies_complete === 1;
  return {
    ...task,
    source: "linear",
    externalOrigin: ref.external_origin,
    externalId: ref.issue_id,
    nativeRef: parseJson(ref.native_ref, null),
    linearDependencies: {
      complete,
      blockedBy,
      unresolvedCount,
      unblocked: complete && unresolvedCount === 0,
    },
  };
}

function installDatabaseDecorators(database, sqlite) {
  if (database.__linearProjectionDecorated === true) return;

  const listProjects = database.listProjects.bind(database);
  const getProject = database.getProject.bind(database);
  const listTasks = database.listTasks.bind(database);
  const getTask = database.getTask.bind(database);
  const createTask = database.createTask.bind(database);
  const updateTask = database.updateTask.bind(database);
  const isLinearProject = (projectId) => Boolean(sqlite.prepare(`
    SELECT 1
    FROM linear_project_refs
    WHERE project_id = ?
  `).get(projectId));

  database.listProjects = (...args) => {
    const refs = projectRefMap(sqlite);
    return listProjects(...args).map((project) => decorateProject(project, refs.get(project.id)));
  };

  database.getProject = (...args) => {
    const project = getProject(...args);
    if (!project) return project;
    const ref = sqlite.prepare(`
      SELECT project_id, external_origin, external_id, native_ref
      FROM linear_project_refs
      WHERE project_id = ?
    `).get(project.id);
    return decorateProject(project, ref);
  };

  database.listTasks = (...args) => {
    const tasks = listTasks(...args);
    const ids = tasks.map((task) => task.id);
    const refs = taskRefMap(sqlite, ids);
    const dependencies = dependencyMap(sqlite, ids);
    return tasks.map((task) => decorateTask(
      task,
      refs.get(task.id),
      dependencies.get(task.id) ?? [],
    ));
  };

  database.getTask = (...args) => {
    const task = getTask(...args);
    if (!task) return task;
    const ref = sqlite.prepare(`
      SELECT task_id, external_origin, issue_id, native_ref, dependencies_complete
      FROM linear_task_refs
      WHERE task_id = ?
    `).get(task.id);
    const dependencies = ref ? dependencyMap(sqlite, [task.id]).get(task.id) ?? [] : [];
    return decorateTask(task, ref, dependencies);
  };

  database.createTask = (input, ...args) => {
    if (isLinearProject(input?.projectId)) {
      throw new ApiError(
        409,
        "LINEAR_READ_ONLY",
        "Local issues cannot be created inside a Linear projection project",
      );
    }
    return createTask(input, ...args);
  };

  database.updateTask = (id, version, changes, ...args) => {
    if (changes?.projectId && isLinearProject(changes.projectId)) {
      throw new ApiError(
        409,
        "LINEAR_READ_ONLY",
        "Local issues cannot be moved into a Linear projection project",
      );
    }
    return updateTask(id, version, changes, ...args);
  };

  Object.defineProperty(database, "__linearProjectionDecorated", {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

function migrate(sqlite) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS linear_project_refs (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      external_origin TEXT NOT NULL,
      external_id TEXT,
      native_ref TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS linear_project_refs_origin
      ON linear_project_refs(external_origin, external_id);

    CREATE TABLE IF NOT EXISTS linear_task_refs (
      task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      external_origin TEXT NOT NULL,
      issue_id TEXT NOT NULL,
      native_ref TEXT NOT NULL,
      dependencies_complete INTEGER NOT NULL DEFAULT 0 CHECK (dependencies_complete IN (0, 1))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS linear_task_refs_origin_issue
      ON linear_task_refs(external_origin, issue_id);

    CREATE TABLE IF NOT EXISTS linear_dependency_refs (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      blocker_issue_id TEXT NOT NULL,
      blocker_identifier TEXT NOT NULL,
      blocker_title TEXT NOT NULL,
      blocker_url TEXT,
      blocker_state_id TEXT,
      blocker_state_type TEXT,
      blocker_state_name TEXT,
      blocker_status TEXT NOT NULL,
      blocker_team_id TEXT,
      blocker_team_key TEXT,
      blocker_project_id TEXT,
      blocker_project_name TEXT,
      blocker_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      resolved INTEGER NOT NULL CHECK (resolved IN (0, 1)),
      PRIMARY KEY (task_id, blocker_issue_id)
    );

    CREATE INDEX IF NOT EXISTS linear_dependency_refs_task_resolved
      ON linear_dependency_refs(task_id, resolved, blocker_identifier);

    CREATE INDEX IF NOT EXISTS linear_dependency_refs_blocker_task
      ON linear_dependency_refs(blocker_task_id);
  `);

  const taskRefColumns = sqlite.prepare("PRAGMA table_info(linear_task_refs)").all();
  if (!taskRefColumns.some((column) => column.name === "dependencies_complete")) {
    sqlite.exec(`
      ALTER TABLE linear_task_refs
      ADD COLUMN dependencies_complete INTEGER NOT NULL DEFAULT 0
        CHECK (dependencies_complete IN (0, 1))
    `);
  }
}

export function installLinearProjection(database) {
  if (!database?.database) throw new TypeError("Taskboard database with a SQLite handle is required");
  const sqlite = database.database;
  migrate(sqlite);
  installDatabaseDecorators(database, sqlite);

  const upsertProject = sqlite.prepare(`
    INSERT INTO projects (
      id, name, workspace_path, labels, next_task_number, created_at, updated_at
    ) VALUES (?, ?, NULL, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      labels = excluded.labels,
      updated_at = excluded.updated_at
  `);
  const upsertProjectRef = sqlite.prepare(`
    INSERT INTO linear_project_refs (project_id, external_origin, external_id, native_ref)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      external_origin = excluded.external_origin,
      external_id = excluded.external_id,
      native_ref = excluded.native_ref
  `);
  const upsertTask = sqlite.prepare(`
    INSERT INTO tasks (
      id, identifier, project_id, title, description, status, priority, labels,
      sort_order, thread_id, thread_codex_project_id, thread_codex_project_kind,
      thread_codex_host_id, thread_workspace_path,
      creator_type, creator_id, creator_name, creator_avatar_url,
      assignee_type, assignee_id, assignee_name, assignee_avatar_url,
      git_branch, worktree_path, worktree_branch,
      start_date, due_date, recurrence_interval, recurrence_unit,
      external_source, external_origin, external_id, external_key, external_url,
      archived_at, version, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, NULL, NULL, NULL,
      NULL, NULL,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      NULL, NULL, NULL,
      NULL, ?, NULL, NULL,
      'linear', ?, ?, ?, ?,
      NULL, 1, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id,
      title = excluded.title,
      description = excluded.description,
      status = excluded.status,
      priority = excluded.priority,
      labels = excluded.labels,
      sort_order = excluded.sort_order,
      creator_type = excluded.creator_type,
      creator_id = excluded.creator_id,
      creator_name = excluded.creator_name,
      creator_avatar_url = excluded.creator_avatar_url,
      assignee_type = excluded.assignee_type,
      assignee_id = excluded.assignee_id,
      assignee_name = excluded.assignee_name,
      assignee_avatar_url = excluded.assignee_avatar_url,
      due_date = excluded.due_date,
      external_source = 'linear',
      external_origin = excluded.external_origin,
      external_id = excluded.external_id,
      external_key = excluded.external_key,
      external_url = excluded.external_url,
      archived_at = NULL,
      version = tasks.version + 1,
      updated_at = excluded.updated_at
  `);
  const upsertTaskRef = sqlite.prepare(`
    INSERT INTO linear_task_refs (
      task_id, external_origin, issue_id, native_ref, dependencies_complete
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      external_origin = excluded.external_origin,
      issue_id = excluded.issue_id,
      native_ref = excluded.native_ref,
      dependencies_complete = excluded.dependencies_complete
  `);
  const deleteDependencies = sqlite.prepare(`
    DELETE FROM linear_dependency_refs WHERE task_id = ?
  `);
  const insertDependency = sqlite.prepare(`
    INSERT INTO linear_dependency_refs (
      task_id,
      blocker_issue_id,
      blocker_identifier,
      blocker_title,
      blocker_url,
      blocker_state_id,
      blocker_state_type,
      blocker_state_name,
      blocker_status,
      blocker_team_id,
      blocker_team_key,
      blocker_project_id,
      blocker_project_name,
      blocker_task_id,
      resolved
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const listExisting = sqlite.prepare(`
    SELECT id
    FROM tasks
    WHERE external_source = 'linear'
      AND external_origin = ?
      AND archived_at IS NULL
  `);
  const archiveTask = sqlite.prepare(`
    UPDATE tasks
    SET archived_at = ?, version = version + 1, updated_at = ?
    WHERE id = ? AND archived_at IS NULL
  `);

  async function syncLinearSnapshot({
    originId,
    organization,
    projects = [],
    issues = [],
    archiveMissing = true,
  } = {}) {
    if (typeof originId !== "string" || !originId) throw new TypeError("originId is required");
    const timestamp = now();
    const issuesByProject = new Map();
    for (const issue of issues) {
      if (!issue?.project?.id) throw new TypeError("Linear issue projection is missing project.id");
      const projectIssues = issuesByProject.get(issue.project.id) ?? [];
      projectIssues.push(issue);
      issuesByProject.set(issue.project.id, projectIssues);
    }
    const taskIdByExternalIssueId = new Map(issues.map((issue) => [issue.externalId, issue.id]));

    let dependencyCount = 0;
    let unresolvedDependencyCount = 0;
    let incompleteDependencyIssueCount = 0;

    sqlite.exec("BEGIN IMMEDIATE");
    try {
      for (const project of projects) {
        const projectIssues = issuesByProject.get(project.id) ?? [];
        upsertProject.run(
          project.id,
          project.name,
          JSON.stringify(uniqueLabels(projectIssues)),
          timestamp,
          timestamp,
        );
        upsertProjectRef.run(
          project.id,
          originId,
          project.externalId ?? null,
          JSON.stringify({
            projectId: project.externalId ?? null,
            projectName: project.name,
            teamId: project.teamId ?? null,
            teamKey: project.teamKey ?? null,
            organizationId: organization?.id ?? null,
          }),
        );
      }

      const seenTaskIds = new Set();
      for (const issue of issues) {
        seenTaskIds.add(issue.id);
        upsertTask.run(
          issue.id,
          issue.identifier,
          issue.project.id,
          issue.title,
          issue.description,
          issue.status,
          issue.priority,
          JSON.stringify(issue.labels ?? []),
          issue.sortOrder,
          issue.creator?.type ?? "user",
          issue.creator?.id ?? "linear:unknown",
          issue.creator?.name ?? "Linear",
          issue.creator?.avatarUrl ?? null,
          issue.assignee?.type ?? "user",
          issue.assignee?.id ?? "linear:unassigned",
          issue.assignee?.name ?? "Unassigned",
          issue.assignee?.avatarUrl ?? null,
          issue.dueDate ?? null,
          originId,
          issue.externalId,
          issue.externalKey,
          issue.externalUrl ?? null,
          issue.createdAt ?? timestamp,
          issue.updatedAt ?? timestamp,
        );
        const dependenciesComplete = issue.linearDependencies?.complete === true;
        upsertTaskRef.run(
          issue.id,
          originId,
          issue.externalId,
          JSON.stringify(issue.nativeRef ?? null),
          dependenciesComplete ? 1 : 0,
        );
        if (!dependenciesComplete) incompleteDependencyIssueCount += 1;
      }

      for (const issue of issues) {
        deleteDependencies.run(issue.id);
        for (const dependency of issue.linearDependencies?.blockedBy ?? []) {
          dependencyCount += 1;
          if (!dependency.resolved) unresolvedDependencyCount += 1;
          insertDependency.run(
            issue.id,
            dependency.issueId,
            dependency.identifier,
            dependency.title,
            dependency.url ?? null,
            dependency.stateId ?? null,
            dependency.stateType ?? null,
            dependency.stateName ?? null,
            dependency.status,
            dependency.teamId ?? null,
            dependency.teamKey ?? null,
            dependency.projectId ?? null,
            dependency.projectName ?? null,
            taskIdByExternalIssueId.get(dependency.issueId) ?? null,
            dependency.resolved ? 1 : 0,
          );
        }
      }

      if (archiveMissing) {
        for (const row of listExisting.all(originId)) {
          if (seenTaskIds.has(row.id)) continue;
          deleteDependencies.run(row.id);
          archiveTask.run(timestamp, timestamp, row.id);
        }
      }
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }

    return {
      projectCount: projects.length,
      issueCount: issues.length,
      dependencyCount,
      unresolvedDependencyCount,
      incompleteDependencyIssueCount,
    };
  }

  database.syncLinearSnapshot = syncLinearSnapshot;

  return {
    syncLinearSnapshot,
  };
}
