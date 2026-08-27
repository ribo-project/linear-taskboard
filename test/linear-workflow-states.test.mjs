import assert from "node:assert/strict";
import test from "node:test";

import { createLinearClient } from "../server/linear-client.mjs";

function response(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("Linear workflow states are read from a team using a String ID", async () => {
  let requestBody = null;
  const client = createLinearClient({
    apiKey: "test-key",
    fetch: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return response({
        data: {
          team: {
            states: {
              nodes: [
                { id: "todo", name: "Todo", type: "unstarted", position: 1 },
                { id: "progress", name: "In Progress", type: "started", position: 2 },
              ],
            },
          },
        },
      });
    },
  });

  const states = await client.listWorkflowStates("team-1");
  assert.deepEqual(states.map((state) => state.id), ["todo", "progress"]);
  assert.deepEqual(requestBody.variables, { teamId: "team-1" });
  assert.match(requestBody.query, /\$teamId:\s*String!/);
  assert.match(requestBody.query, /team\(id:\s*\$teamId\)/);
});
