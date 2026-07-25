/**
 * Databricks SQL Scripting skill.
 *
 * Distilled from:
 *   - sql-scripting.md (compound statements, control flow, exception handling)
 *   - Stored procedures, recursive CTEs, EXECUTE IMMEDIATE
 *
 * Covers procedural SQL patterns for ETL orchestration, stored procedures,
 * and recursive CTE patterns for hierarchy/graph traversal.
 */

import type { SkillDefinition } from "../types";
import { registerSkill } from "../registry";

const SCRIPTING_CORE = `SQL Scripting Core (DBR 16.3+):
- Compound statement: BEGIN ... END (wrap multiple statements in a single execution block)
- Variables: DECLARE var_name TYPE [DEFAULT value]; SET VAR var_name = expr
- Control flow:
  - IF condition THEN ... ELSEIF condition THEN ... ELSE ... END IF
  - CASE var WHEN value THEN ... END CASE (simple) or CASE WHEN cond THEN ... END CASE (searched)
  - WHILE condition DO ... END WHILE
  - FOR row AS (SELECT ...) DO ... END FOR (iterate query rows)
  - LOOP ... END LOOP (infinite loop, break with LEAVE)
  - REPEAT ... UNTIL condition END REPEAT
  - LEAVE label: exit the named loop/block; ITERATE label: skip to next iteration
- Exception handling:
  - DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ... END (catch any SQL error, exit block)
  - DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN ... END (catch error, continue)
  - SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'custom error' (raise user error)
  - RESIGNAL (re-throw caught exception)
- Dynamic SQL: EXECUTE IMMEDIATE sql_string [INTO var_list] [USING param_list]
- All variables are scoped to their enclosing BEGIN/END block`;

const STORED_PROCEDURES = `Stored Procedures (DBR 17.0+):
- CREATE OR REPLACE PROCEDURE catalog.schema.proc_name(IN p1 TYPE, OUT p2 TYPE, INOUT p3 TYPE)
  LANGUAGE SQL
  SQL SECURITY INVOKER
  BEGIN ... END
- IN parameters: read-only input (default if direction omitted)
- OUT parameters: write-only output, initialized to NULL
- INOUT parameters: read-write, initial value from caller
- CALL catalog.schema.proc_name(arg1, ?) for positional args; CALL proc(p1 => val) for named args
- DEFAULT value for IN params makes them optional in CALL
- DESCRIBE PROCEDURE, SHOW PROCEDURES, DROP PROCEDURE for management
- SQL SECURITY INVOKER: runs with caller's permissions (recommended)
- SQL SECURITY DEFINER: runs with creator's permissions (use sparingly)`;

const RECURSIVE_CTES = `Recursive CTEs (DBR 17.0+):
- WITH RECURSIVE cte_name AS (
    anchor_query          -- non-recursive base case
    UNION ALL
    recursive_query       -- references cte_name
  ) SELECT * FROM cte_name
- Default MAX RECURSION LEVEL: 100 iterations (prevents infinite loops)
- Override: ALTER SESSION SET MAX_RECURSION_LEVEL = N; or LIMIT ALL in the recursive query
- Hierarchy traversal: anchor = root nodes (WHERE parent_id IS NULL), recurse = JOIN children on parent_id
- Path tracking: ARRAY(name) in anchor, array_append(path, name) in recursive step
- Cycle detection: track visited IDs in an ARRAY, filter WHERE NOT array_contains(visited, id)
- BOM explosion: anchor = top-level assembly, recurse = components with cumulative quantity (parent_qty * component_qty)
- Number series: anchor = 1, recursive = n + 1 WHERE n < max (useful for date range generation)
- Graph traversal: anchor = start node, recurse = JOIN edges WHERE NOT in visited set`;

const skill: SkillDefinition = {
  id: "databricks-sql-scripting",
  name: "Databricks SQL Scripting",
  description:
    "Procedural SQL: compound statements, control flow, exception handling, " +
    "stored procedures (IN/OUT/INOUT), recursive CTEs for hierarchies and graphs.",
  relevance: {
    intents: ["technical"],
    pipelineSteps: ["sql-generation"],
  },
  chunks: [
    {
      id: "sql-scripting-core",
      title: "SQL Scripting Core",
      content: SCRIPTING_CORE,
      category: "patterns",
    },
    {
      id: "sql-stored-procedures",
      title: "Stored Procedures",
      content: STORED_PROCEDURES,
      category: "patterns",
    },
    {
      id: "sql-recursive-ctes",
      title: "Recursive CTEs",
      content: RECURSIVE_CTES,
      category: "patterns",
    },
  ],
};

registerSkill(skill);

export default skill;
