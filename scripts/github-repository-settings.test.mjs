import assert from "node:assert/strict";
import test from "node:test";

import {
  actionsArguments,
  patchArguments,
  repositorySettingsDiff,
  topicsArguments,
} from "./github-repository-settings.mjs";

test("repository settings diff reports only managed drift", () => {
  assert.deepEqual(
    repositorySettingsDiff(
      { description: "English", allow_squash_merge: true },
      { description: "Português", allow_squash_merge: true, private: false },
    ),
    [{ key: "description", expected: "English", actual: "Português" }],
  );
});

test("repository patch preserves boolean field types", () => {
  assert.deepEqual(
    patchArguments(
      { description: "English", allow_squash_merge: true },
      "Yefclub/Voxen",
    ),
    [
      "api",
      "--method",
      "PATCH",
      "repos/Yefclub/Voxen",
      "-f",
      "description=English",
      "-F",
      "allow_squash_merge=true",
    ],
  );
});

test("topic and Actions updates target their dedicated endpoints", () => {
  assert.deepEqual(topicsArguments(["mcp", "self-hosted"], "Yefclub/Voxen"), [
    "api",
    "--method",
    "PUT",
    "repos/Yefclub/Voxen/topics",
    "-f",
    "names[]=mcp",
    "-f",
    "names[]=self-hosted",
  ]);
  assert.deepEqual(
    actionsArguments(
      {
        default_workflow_permissions: "read",
        can_approve_pull_request_reviews: false,
      },
      "Yefclub/Voxen",
    ),
    [
      "api",
      "--method",
      "PUT",
      "repos/Yefclub/Voxen/actions/permissions/workflow",
      "-f",
      "default_workflow_permissions=read",
      "-F",
      "can_approve_pull_request_reviews=false",
    ],
  );
});
