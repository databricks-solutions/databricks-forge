/**
 * Fixture serialized_space JSON objects for health check tests.
 */

function hexId(n: number): string {
  return n.toString(16).padStart(32, "0");
}

/** A well-configured space that should pass all checks. */
export const perfectSpace = {
  version: 2,
  config: {
    sample_questions: [
      { id: hexId(100), question: ["What is revenue?"] },
      { id: hexId(101), question: ["Show top customers."] },
    ],
  },
  data_sources: {
    tables: [
      {
        id: hexId(1),
        identifier: "catalog.schema.orders",
        description: ["Order transactions"],
        column_configs: [
          {
            id: hexId(10),
            name: "order_id",
            description: ["Unique order ID"],
            synonyms: ["id"],
            enable_entity_matching: true,
            enable_format_assistance: true,
          },
          {
            id: hexId(11),
            name: "customer_id",
            description: ["Customer FK"],
            synonyms: ["cust"],
            enable_entity_matching: false,
          },
          {
            id: hexId(12),
            name: "total",
            description: ["Order total"],
            synonyms: ["amount"],
            enable_entity_matching: false,
          },
        ],
      },
      {
        id: hexId(2),
        identifier: "catalog.schema.customers",
        description: ["Customer master"],
        column_configs: [
          {
            id: hexId(20),
            name: "customer_id",
            description: ["Primary key"],
            synonyms: ["id"],
            enable_entity_matching: true,
          },
          {
            id: hexId(21),
            name: "name",
            description: ["Full name"],
            synonyms: ["customer name"],
            enable_entity_matching: true,
          },
        ],
      },
    ],
  },
  instructions: {
    text_instructions: [{ id: hexId(30), content: ["This space is about order analytics."] }],
    example_question_sqls: Array.from({ length: 10 }, (_, i) => ({
      id: hexId(40 + i),
      question: [`Question ${i + 1}`],
      sql: [`SELECT col_${i} FROM table_${i}`],
      usage_guidance: `Guidance for question ${i + 1}`,
    })),
    join_specs: [
      {
        id: hexId(50),
        left: { identifier: "catalog.schema.orders", alias: "o" },
        right: { identifier: "catalog.schema.customers", alias: "c" },
        sql: ["o.customer_id = c.customer_id"],
        comment: "Orders to customers FK relationship",
      },
    ],
    sql_snippets: {
      measures: [
        {
          id: hexId(60),
          alias: "total_revenue",
          sql: ["SUM(o.total)"],
          display_name: "Total Revenue",
          synonyms: ["revenue"],
          comment: "Sum of order totals",
        },
        {
          id: hexId(61),
          alias: "order_count",
          sql: ["COUNT(o.order_id)"],
          display_name: "Order Count",
          synonyms: ["num orders"],
          comment: "Number of orders",
        },
      ],
      filters: [
        {
          id: hexId(70),
          sql: ["o.order_date >= DATEADD(month, -1, CURRENT_DATE())"],
          display_name: "Last 30 days",
          synonyms: ["recent"],
          comment: "Filter to last 30 days",
        },
      ],
      expressions: [
        {
          id: hexId(80),
          alias: "is_high_value",
          sql: ["o.total > 1000"],
          synonyms: ["premium"],
          display_name: "High Value Order",
          instruction: "Use to identify high value orders",
        },
      ],
    },
  },
  benchmarks: {
    questions: Array.from({ length: 10 }, (_, i) => ({
      id: hexId(90 + i),
      question: [`Benchmark question ${i + 1}`],
      answer: `SELECT answer_${i} FROM table`,
    })),
  },
};

/** An empty space with no tables or instructions. */
export const emptySpace = {
  version: 2,
  config: {
    sample_questions: [],
  },
  data_sources: {
    tables: [],
  },
  instructions: {
    text_instructions: [],
    example_question_sqls: [],
    join_specs: [],
    sql_snippets: {
      measures: [],
      filters: [],
      expressions: [],
    },
  },
};

/** A partially configured space (single table, some content). */
export const partialSpace = {
  version: 2,
  config: {
    sample_questions: [{ id: hexId(200), question: ["Show me sales"] }],
  },
  data_sources: {
    tables: [
      {
        id: hexId(201),
        identifier: "catalog.schema.sales",
        description: ["Sales data"],
        column_configs: [
          { id: hexId(210), name: "sale_id", description: [""], synonyms: [] },
          { id: hexId(211), name: "amount", description: ["Sale amount"], synonyms: [] },
          { id: hexId(212), name: "date", description: [], synonyms: [] },
        ],
      },
    ],
  },
  instructions: {
    text_instructions: [{ id: hexId(220), content: ["Analyze sales."] }],
    example_question_sqls: [
      {
        id: hexId(230),
        question: ["What is total sales?"],
        sql: ["SELECT SUM(amount) FROM sales"],
      },
      {
        id: hexId(231),
        question: ["Show by month"],
        sql: ["SELECT month, SUM(amount) FROM sales GROUP BY month"],
      },
    ],
    join_specs: [],
    sql_snippets: {
      measures: [],
      filters: [],
      expressions: [],
    },
  },
};

/** Space with duplicate IDs -- should fail uniqueness check. */
export const duplicateIdSpace = {
  version: 2,
  config: { sample_questions: [] },
  data_sources: {
    tables: [
      { id: hexId(1), identifier: "cat.sch.t1", column_configs: [{ id: hexId(1), name: "col" }] },
    ],
  },
  instructions: {
    text_instructions: [],
    example_question_sqls: [],
    join_specs: [],
    sql_snippets: { measures: [], filters: [], expressions: [] },
  },
};

/** Space with empty SQL in snippets -- should fail no_empty_sql check. */
export const emptySqlSpace = {
  version: 2,
  config: { sample_questions: [] },
  data_sources: {
    tables: [{ id: hexId(300), identifier: "cat.sch.t1" }],
  },
  instructions: {
    text_instructions: [],
    example_question_sqls: [],
    join_specs: [],
    sql_snippets: {
      measures: [{ id: hexId(301), alias: "m1", sql: [], display_name: "M1" }],
      filters: [{ id: hexId(302), sql: [""], display_name: "F1" }],
      expressions: [],
    },
  },
};
