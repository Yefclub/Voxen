const MIGRATION_PATH =
  /^prisma\/migrations\/(\d{14}_[a-z0-9_]+)\/migration\.sql$/;

export function analyzeMigrationHistory({
  currentMigrations,
  baseMigrations = null,
  schemaChanged = false,
  migrationLock = "",
}) {
  const failures = [];
  const entries = [...currentMigrations.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const names = new Map();

  if (!/^provider\s*=\s*"postgresql"\s*$/m.test(migrationLock)) {
    failures.push({
      code: "migration-lock",
      message:
        "prisma/migrations/migration_lock.toml must declare the postgresql provider.",
    });
  }

  for (const [path, sql] of entries) {
    const match = path.match(MIGRATION_PATH);
    if (!match) {
      failures.push({
        code: "invalid-migration-path",
        path,
        message: `${path} must use prisma/migrations/YYYYMMDDHHMMSS_slug/migration.sql.`,
      });
      continue;
    }
    const name = match[1];
    const timestamp = name.slice(0, 14);
    if (names.has(timestamp)) {
      failures.push({
        code: "duplicate-migration-timestamp",
        path,
        message: `${path} reuses migration timestamp ${timestamp} from ${names.get(timestamp)}.`,
      });
    } else {
      names.set(timestamp, path);
    }
    if (sql.trim().length === 0) {
      failures.push({
        code: "empty-migration",
        path,
        message: `${path} is empty.`,
      });
    }
  }

  const additions = [];
  if (baseMigrations) {
    for (const [path, baseSql] of baseMigrations) {
      if (!currentMigrations.has(path)) {
        failures.push({
          code: "immutable-migration-deleted",
          path,
          message: `${path} exists on the target branch and cannot be deleted or renamed.`,
        });
      } else if (currentMigrations.get(path) !== baseSql) {
        failures.push({
          code: "immutable-migration-edited",
          path,
          message: `${path} exists on the target branch and must remain byte-for-byte unchanged.`,
        });
      }
    }

    for (const [path] of entries) {
      if (!baseMigrations.has(path)) additions.push(path);
    }

    const baseNames = [...baseMigrations.keys()]
      .map((path) => path.match(MIGRATION_PATH)?.[1])
      .filter(Boolean)
      .sort();
    const latestBase = baseNames.at(-1) ?? "";
    for (const path of additions) {
      const name = path.match(MIGRATION_PATH)?.[1];
      if (name && latestBase && name.localeCompare(latestBase) <= 0) {
        failures.push({
          code: "out-of-order-migration",
          path,
          message: `${path} must sort after target migration ${latestBase}.`,
        });
      }
    }

    if (schemaChanged && additions.length === 0) {
      failures.push({
        code: "schema-without-migration",
        path: "prisma/schema.prisma",
        message: "prisma/schema.prisma changed without a new migration.",
      });
    }
  }

  return { migrations: entries.length, additions, failures };
}

export function validateGateDatabaseUrls(databaseUrl, shadowDatabaseUrl) {
  const failures = [];
  for (const [label, value, suffix] of [
    ["MIGRATION_GATE_DATABASE_URL", databaseUrl, "migration_gate"],
    ["MIGRATION_GATE_SHADOW_DATABASE_URL", shadowDatabaseUrl, "shadow"],
  ]) {
    try {
      const url = new URL(value);
      const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
      const hostname =
        url.hostname.startsWith("[") && url.hostname.endsWith("]")
          ? url.hostname.slice(1, -1)
          : url.hostname;
      if (!["postgres:", "postgresql:"].includes(url.protocol))
        throw new Error("must use PostgreSQL");
      if (!["localhost", "127.0.0.1", "::1"].includes(hostname))
        throw new Error("must use a loopback host");
      if (!database.endsWith(suffix))
        throw new Error(`database name must end with ${suffix}`);
    } catch (error) {
      failures.push({
        code: "unsafe-database-url",
        message: `${label} ${error instanceof Error ? error.message : "is invalid"}.`,
      });
    }
  }
  if (databaseUrl && databaseUrl === shadowDatabaseUrl) {
    failures.push({
      code: "shared-database-url",
      message: "Migration target and shadow database URLs must be different.",
    });
  }
  return failures;
}

export function unexpectedDriftStatements(source, ignoredIndexes) {
  if (
    !Array.isArray(ignoredIndexes) ||
    ignoredIndexes.some(
      (name) => typeof name !== "string" || !/^[A-Za-z0-9_]+$/.test(name),
    )
  ) {
    throw new Error("Drift allowlist contains an invalid index name.");
  }
  const allowed = new Set(
    ignoredIndexes.map((name) => `DROP INDEX "${name}";`),
  );
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("--"))
    .filter((line) => !allowed.has(line));
}

export function missingCustomGinIndexes(migrationSql, ignoredIndexes) {
  if (
    !Array.isArray(ignoredIndexes) ||
    ignoredIndexes.some(
      (name) => typeof name !== "string" || !/^[A-Za-z0-9_]+$/.test(name),
    )
  ) {
    throw new Error("Drift allowlist contains an invalid index name.");
  }
  const indexes = finalIndexMethods(migrationSql);
  return ignoredIndexes.filter((name) => indexes.get(name) !== "GIN");
}

function sqlStatements(source) {
  const statements = [];
  let statement = "";
  let state = "normal";
  let dollarTag = "";
  let blockDepth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] ?? "";

    if (state === "line-comment") {
      if (char === "\n") {
        state = "normal";
        statement += "\n";
      }
      continue;
    }
    if (state === "block-comment") {
      if (char === "/" && next === "*") {
        blockDepth += 1;
        index += 1;
      } else if (char === "*" && next === "/") {
        blockDepth -= 1;
        index += 1;
        if (blockDepth === 0) state = "normal";
      }
      continue;
    }
    if (state === "single-quote") {
      if (char === "\\") {
        index += 1;
      } else if (char === "'" && next === "'") {
        index += 1;
      } else if (char === "'") {
        state = "normal";
        statement += "''";
      }
      continue;
    }
    if (state === "double-quote") {
      statement += char;
      if (char === '"' && next === '"') {
        statement += next;
        index += 1;
      } else if (char === '"') {
        state = "normal";
      }
      continue;
    }
    if (state === "dollar-quote") {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        state = "normal";
        statement += "''";
      }
      continue;
    }

    if (char === "-" && next === "-") {
      state = "line-comment";
      index += 1;
    } else if (char === "/" && next === "*") {
      state = "block-comment";
      blockDepth = 1;
      index += 1;
    } else if (char === "'") {
      state = "single-quote";
    } else if (char === '"') {
      state = "double-quote";
      statement += char;
    } else if (char === "$") {
      const match = source
        .slice(index)
        .match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarTag = match[0];
        state = "dollar-quote";
        index += dollarTag.length - 1;
      } else {
        statement += char;
      }
    } else if (char === ";") {
      if (statement.trim()) statements.push(statement.trim());
      statement = "";
    } else {
      statement += char;
    }
  }

  if (statement.trim()) statements.push(statement.trim());
  return statements;
}

function finalIndexMethods(source) {
  const indexes = new Map();
  for (const statement of sqlStatements(source)) {
    const create = statement.match(
      /^CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+CONCURRENTLY)?(\s+IF\s+NOT\s+EXISTS)?\s+"((?:[^"]|"")+)"([\s\S]*)$/i,
    );
    if (create) {
      const name = create[2].replaceAll('""', '"');
      if (create[1] && indexes.has(name)) continue;
      const method = stripQuotedIdentifiers(create[3]).match(
        /\bUSING\s+([A-Za-z][A-Za-z0-9_]*)\b/i,
      );
      indexes.set(name, (method?.[1] ?? "BTREE").toUpperCase());
      continue;
    }

    const drop = statement.match(
      /^DROP\s+INDEX(?:\s+CONCURRENTLY)?(?:\s+IF\s+EXISTS)?\s+([\s\S]+)$/i,
    );
    if (drop) {
      for (const match of drop[1].matchAll(/"([^"]+)"/g)) {
        indexes.delete(match[1]);
      }
      continue;
    }

    const rename = statement.match(
      /^ALTER\s+INDEX(?:\s+IF\s+EXISTS)?\s+"([^"]+)"\s+RENAME\s+TO\s+"([^"]+)"$/i,
    );
    if (rename && indexes.has(rename[1])) {
      const method = indexes.get(rename[1]);
      indexes.delete(rename[1]);
      indexes.set(rename[2], method);
    }
  }
  return indexes;
}

function stripQuotedIdentifiers(source) {
  let output = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] ?? "";
    if (!quoted && char === '"') {
      quoted = true;
      output += '""';
    } else if (quoted && char === '"' && next === '"') {
      index += 1;
    } else if (quoted && char === '"') {
      quoted = false;
    } else if (!quoted) {
      output += char;
    }
  }
  return output;
}
