import { linearClaimEligibility } from "./linear-claim.mjs";

function decorate(task) {
  if (!task || task.source !== "linear") return task;
  return {
    ...task,
    claimEligibility: linearClaimEligibility(task),
  };
}

export function installLinearClaimDecoration(database) {
  if (!database || database.__linearClaimDecorated === true) return;

  const listTasks = database.listTasks.bind(database);
  const getTask = database.getTask.bind(database);

  database.listTasks = (...args) => listTasks(...args).map(decorate);
  database.getTask = (...args) => decorate(getTask(...args));

  Object.defineProperty(database, "__linearClaimDecorated", {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}
