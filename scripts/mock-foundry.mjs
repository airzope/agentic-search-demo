#!/usr/bin/env node
/**
 * Local mock of the Foundry Ontology API v2, for development and tests only.
 *
 * It serves a small supply-chain ontology (suppliers, parts, purchase orders,
 * quality incidents; CJK data) through the endpoints that @osdk/client and
 * @osdk/oauth call: ontologies, object type metadata, objectSets/loadObjects,
 * objectSets/aggregate, query types and execution, action types and apply,
 * and the OAuth client-credentials token endpoint.
 *
 *   node scripts/mock-foundry.mjs            # http://127.0.0.1:4020
 *   PORT=4021 MOCK_FOUNDRY_TOKEN=secret node scripts/mock-foundry.mjs
 *
 * Connect with URL http://127.0.0.1:4020, ontology `supply-chain`, token
 * `dev-token` (or OAuth client `dev-client` / `dev-secret`).
 */
import { randomUUID } from "node:crypto";
import http from "node:http";

const PORT = Number(process.env.PORT ?? 4020);
const TOKEN = process.env.MOCK_FOUNDRY_TOKEN ?? "dev-token";
const CLIENT = { id: "dev-client", secret: "dev-secret" };
const issued = new Set([TOKEN]);

const ONTOLOGY = {
  apiName: "supply-chain",
  displayName: "供应链本体",
  description: "Mock supply-chain ontology for local development",
  rid: "ri.ontology.main.ontology.5c1e0000-0000-4000-8000-000000000001",
};

/* ---------------------------------------------------------------- data */

const SUPPLIERS = [
  ["S001", "华东精密制造", "中国", "苏州", "A", "机加工", true],
  ["S002", "深圳星河电子", "中国", "深圳", "B", "电子元件", true],
  ["S003", "東京精工株式会社", "日本", "東京", "A", "精密轴承", true],
  ["S004", "大阪化学工業", "日本", "大阪", "B", "化工材料", false],
  ["S005", "서울반도체", "韩国", "首尔", "A", "半导体", true],
  ["S006", "宁波海天模具", "中国", "宁波", "C", "模具", false],
  ["S007", "台中機械", "中国台湾", "台中", "B", "机加工", true],
  ["S008", "成都蜀川新材", "中国", "成都", "C", "化工材料", false],
].map(([supplierId, name, country, city, rating, category, certified]) => ({
  supplierId,
  name,
  country,
  city,
  rating,
  category,
  certified,
}));

const PARTS = [
  ["P101", "主轴轴承 6205", "精密轴承", 38.5, "S003", 1200, 21],
  ["P102", "伺服电机驱动板", "电子元件", 420, "S002", 160, 14],
  ["P103", "铝合金壳体", "机加工", 96, "S001", 800, 10],
  ["P104", "注塑模具 A 型", "模具", 18500, "S006", 4, 45],
  ["P105", "环氧树脂胶", "化工材料", 65, "S004", 300, 18],
  ["P106", "功率 MOSFET", "半导体", 12.8, "S005", 5000, 30],
  ["P107", "精密齿轮组", "机加工", 260, "S007", 240, 20],
  ["P108", "导热硅脂", "化工材料", 22, "S008", 900, 12],
  ["P109", "直线导轨", "机加工", 310, "S001", 150, 15],
  ["P110", "角接触轴承 7008", "精密轴承", 145, "S003", 400, 25],
  ["P111", "温度传感器", "电子元件", 48, "S002", 1500, 10],
  ["P112", "LED 驱动芯片", "半导体", 6.4, "S005", 8000, 35],
].map(
  ([partId, name, category, unitPrice, supplierId, stock, leadTimeDays]) => ({
    partId,
    name,
    category,
    unitPrice,
    supplierId,
    stock,
    leadTimeDays,
  }),
);

// Deterministic pseudo-random numbers so every run serves the same data.
let seed = 7;
const random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const STATUSES = ["已到货", "已到货", "已下单", "延误", "待审批"];
const PLANTS = ["上海工厂", "苏州工厂", "武汉工厂"];
const ORDERS = Array.from({ length: 36 }, (_, i) => {
  const part = PARTS[Math.floor(random() * PARTS.length)];
  // Two suppliers are reliably late, to make the risk question interesting.
  const lateBias = part.supplierId === "S006" || part.supplierId === "S008";
  const status =
    lateBias && random() < 0.6
      ? "延误"
      : STATUSES[Math.floor(random() * STATUSES.length)];
  const quantity = 10 + Math.floor(random() * 50) * 10;
  const month = 1 + Math.floor(random() * 9);
  const day = 1 + Math.floor(random() * 27);
  const orderDate = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const expected = new Date(Date.UTC(2026, month - 1, day + part.leadTimeDays));
  return {
    orderId: `PO-2026-${String(i + 1).padStart(4, "0")}`,
    partId: part.partId,
    supplierId: part.supplierId,
    quantity,
    amount: Math.round(quantity * part.unitPrice * 100) / 100,
    status,
    orderDate,
    expectedDate: expected.toISOString().slice(0, 10),
    plant: PLANTS[Math.floor(random() * PLANTS.length)],
    priority: null,
    escalationNote: null,
  };
});

const INCIDENTS = [
  [
    "QI-01",
    "S006",
    "P104",
    "高",
    "2026-03-12",
    "模具型腔尺寸超差 0.3mm，导致整批注塑件报废",
  ],
  ["QI-02", "S006", "P104", "中", "2026-06-02", "交付模具缺少热处理报告"],
  [
    "QI-03",
    "S008",
    "P108",
    "高",
    "2026-04-20",
    "导热硅脂批次粘度不合格，客户投诉",
  ],
  ["QI-04", "S008", "P108", "中", "2026-07-15", "包装破损，约 5% 产品受潮"],
  ["QI-05", "S002", "P102", "低", "2026-02-08", "驱动板丝印错误，已返工"],
  [
    "QI-06",
    "S004",
    "P105",
    "中",
    "2026-05-30",
    "環氧樹脂の硬化時間が仕様より長い",
  ],
  ["QI-07", "S003", "P110", "低", "2026-08-11", "外箱标签与订单号不一致"],
  ["QI-08", "S006", "P104", "高", "2026-09-03", "模具顶针断裂，停线 6 小时"],
  ["QI-09", "S005", "P106", "低", "2026-01-25", "일부 MOSFET 포장 라벨 누락"],
].map(([incidentId, supplierId, partId, severity, date, description]) => ({
  incidentId,
  supplierId,
  partId,
  severity,
  date,
  description,
}));

/* ------------------------------------------------------------- metadata */

const prop = (displayName, type, description) => ({
  displayName,
  description,
  dataType: { type },
  rid: `ri.ontology.main.property.${randomUUID()}`,
  typeClasses: [],
});

const TYPES = {
  Supplier: {
    displayName: "供应商",
    pluralDisplayName: "供应商",
    description: "Suppliers of parts and materials, with quality rating",
    primaryKey: "supplierId",
    titleProperty: "name",
    icon: "office",
    data: SUPPLIERS,
    properties: {
      supplierId: prop("供应商编号", "string"),
      name: prop("名称", "string"),
      country: prop("国家/地区", "string"),
      city: prop("城市", "string"),
      rating: prop("评级", "string", "A (best) to C"),
      category: prop("品类", "string"),
      certified: prop("通过认证", "boolean", "ISO 9001 certified"),
    },
  },
  Part: {
    displayName: "零件",
    pluralDisplayName: "零件",
    description: "Purchased parts with price, stock and lead time",
    primaryKey: "partId",
    titleProperty: "name",
    icon: "cube",
    data: PARTS,
    properties: {
      partId: prop("零件编号", "string"),
      name: prop("名称", "string"),
      category: prop("品类", "string"),
      unitPrice: prop("单价（元）", "double"),
      supplierId: prop("供应商编号", "string"),
      stock: prop("库存", "integer"),
      leadTimeDays: prop("交期（天）", "integer"),
    },
  },
  PurchaseOrder: {
    displayName: "采购订单",
    pluralDisplayName: "采购订单",
    description:
      "Purchase orders; status is one of 待审批, 已下单, 已到货, 延误",
    primaryKey: "orderId",
    titleProperty: "orderId",
    icon: "shopping-cart",
    data: ORDERS,
    properties: {
      orderId: prop("订单号", "string"),
      partId: prop("零件编号", "string"),
      supplierId: prop("供应商编号", "string"),
      quantity: prop("数量", "integer"),
      amount: prop("金额（元）", "double"),
      status: prop("状态", "string", "待审批 / 已下单 / 已到货 / 延误"),
      orderDate: prop("下单日期", "date"),
      expectedDate: prop("预计到货", "date"),
      plant: prop("收货工厂", "string"),
      priority: prop("升级优先级", "string"),
      escalationNote: prop("升级说明", "string"),
    },
  },
  QualityIncident: {
    displayName: "质量事件",
    pluralDisplayName: "质量事件",
    description: "Quality incidents raised against suppliers and parts",
    primaryKey: "incidentId",
    titleProperty: "description",
    icon: "warning-sign",
    data: INCIDENTS,
    properties: {
      incidentId: prop("事件编号", "string"),
      supplierId: prop("供应商编号", "string"),
      partId: prop("零件编号", "string"),
      severity: prop("严重程度", "string", "高 / 中 / 低"),
      date: prop("日期", "date"),
      description: prop("描述", "string"),
    },
  },
};

/** Links: [from type, api name, display, to type, cardinality, from key, to key]. */
const LINKS = [
  ["Supplier", "parts", "零件", "Part", "MANY", "supplierId", "supplierId"],
  [
    "Supplier",
    "orders",
    "采购订单",
    "PurchaseOrder",
    "MANY",
    "supplierId",
    "supplierId",
  ],
  [
    "Supplier",
    "incidents",
    "质量事件",
    "QualityIncident",
    "MANY",
    "supplierId",
    "supplierId",
  ],
  ["Part", "supplier", "供应商", "Supplier", "ONE", "supplierId", "supplierId"],
  ["Part", "orders", "采购订单", "PurchaseOrder", "MANY", "partId", "partId"],
  [
    "PurchaseOrder",
    "supplier",
    "供应商",
    "Supplier",
    "ONE",
    "supplierId",
    "supplierId",
  ],
  ["PurchaseOrder", "part", "零件", "Part", "ONE", "partId", "partId"],
  [
    "QualityIncident",
    "supplier",
    "供应商",
    "Supplier",
    "ONE",
    "supplierId",
    "supplierId",
  ],
].map(([from, apiName, displayName, to, cardinality, fromKey, toKey]) => ({
  from,
  apiName,
  displayName,
  to,
  cardinality,
  fromKey,
  toKey,
  rid: `ri.ontology.main.relation.${randomUUID()}`,
}));

const TYPE_RIDS = Object.fromEntries(
  Object.keys(TYPES).map((name) => [
    name,
    `ri.ontology.main.object-type.${randomUUID()}`,
  ]),
);
const OBJECT_RIDS = new Map();
const objectRid = (type, key) => {
  const id = `${type}:${key}`;
  if (!OBJECT_RIDS.has(id))
    OBJECT_RIDS.set(id, `ri.phonograph2-objects.main.object.${randomUUID()}`);
  return OBJECT_RIDS.get(id);
};

function objectTypeV2(apiName) {
  const type = TYPES[apiName];
  return {
    apiName,
    displayName: type.displayName,
    pluralDisplayName: type.pluralDisplayName,
    description: type.description,
    status: "ACTIVE",
    icon: { type: "blueprint", name: type.icon, color: "#4C90F0" },
    primaryKey: type.primaryKey,
    titleProperty: type.titleProperty,
    properties: type.properties,
    rid: TYPE_RIDS[apiName],
    visibility: "NORMAL",
    aliases: [],
    datasources: [],
  };
}

const linkSide = (link) => ({
  apiName: link.apiName,
  displayName: link.displayName,
  status: "ACTIVE",
  objectTypeApiName: link.to,
  cardinality: link.cardinality,
  linkTypeRid: link.rid,
  ...(link.cardinality === "ONE"
    ? { foreignKeyPropertyApiName: link.fromKey }
    : {}),
});

const QUERIES = {
  supplierRiskScore: {
    apiName: "supplierRiskScore",
    displayName: "供应商风险评分",
    description:
      "Risk score 0-100 from delayed orders, quality incidents (weighted by severity) and rating. Higher is riskier.",
    parameters: {
      supplierId: {
        description: "Supplier id, e.g. S001",
        dataType: { type: "string" },
        required: true,
      },
    },
    output: { type: "double" },
    rid: "ri.function-registry.main.function.risk-score",
    version: "1.2.0",
    typeReferences: {},
  },
};

const ACTIONS = {
  escalateOrder: {
    apiName: "escalateOrder",
    displayName: "升级采购订单",
    description:
      "Escalate a purchase order: set its escalation priority and note.",
    status: "ACTIVE",
    parameters: {
      orderId: {
        displayName: "订单号",
        dataType: { type: "string" },
        required: true,
        typeClasses: [],
      },
      priority: {
        displayName: "优先级",
        description: "高 / 中 / 低",
        dataType: { type: "string" },
        required: true,
        typeClasses: [],
      },
      note: {
        displayName: "说明",
        dataType: { type: "string" },
        required: false,
        typeClasses: [],
      },
    },
    rid: "ri.actions.main.action-type.escalate-order",
    operations: [{ type: "modifyObject", objectTypeApiName: "PurchaseOrder" }],
  },
};

/* ---------------------------------------------------------- evaluation */

const fieldOf = (filter, type) => {
  if (filter.field) return filter.field;
  const id = filter.propertyIdentifier;
  if (id?.type === "primaryKeyProperty") return TYPES[type].primaryKey;
  if (id?.type === "titleProperty") return TYPES[type].titleProperty;
  return id?.apiName;
};

const terms = (value) =>
  String(value).toLowerCase().split(/\s+/).filter(Boolean);

function matches(filter, object, type) {
  switch (filter.type) {
    case "and":
      return filter.value.every((item) => matches(item, object, type));
    case "or":
      return filter.value.some((item) => matches(item, object, type));
    case "not":
      return !matches(filter.value, object, type);
  }
  const field = fieldOf(filter, type);
  if (!(field in TYPES[type].properties)) {
    throw httpError(
      400,
      "INVALID_ARGUMENT",
      "PropertiesNotFound",
      `Unknown property ${field} on ${type}`,
      { properties: [field] },
    );
  }
  const value = object[field];
  switch (filter.type) {
    case "eq":
      return value === filter.value;
    case "gt":
      return value !== null && value > filter.value;
    case "gte":
      return value !== null && value >= filter.value;
    case "lt":
      return value !== null && value < filter.value;
    case "lte":
      return value !== null && value <= filter.value;
    case "in":
      return filter.value.includes(value);
    case "isNull":
      return (value === null || value === undefined) === filter.value;
    case "startsWith":
      return typeof value === "string" && value.startsWith(filter.value);
    case "contains":
      return Array.isArray(value)
        ? value.includes(filter.value)
        : String(value ?? "").includes(filter.value);
    case "containsAllTerms":
    case "containsAllTermsInOrder":
      return terms(filter.value).every((term) =>
        String(value ?? "")
          .toLowerCase()
          .includes(term),
      );
    case "containsAnyTerm":
      return terms(filter.value).some((term) =>
        String(value ?? "")
          .toLowerCase()
          .includes(term),
      );
    default:
      throw httpError(
        400,
        "INVALID_ARGUMENT",
        "InvalidQuery",
        `Unsupported filter ${filter.type}`,
      );
  }
}

/** Evaluate an object set to { type, objects }. */
function evaluate(set) {
  switch (set.type) {
    case "base": {
      if (!TYPES[set.objectType])
        throw notFound("ObjectTypeNotFound", { objectType: set.objectType });
      return { type: set.objectType, objects: TYPES[set.objectType].data };
    }
    case "filter": {
      const inner = evaluate(set.objectSet);
      return {
        type: inner.type,
        objects: inner.objects.filter((o) => matches(set.where, o, inner.type)),
      };
    }
    case "searchAround": {
      const inner = evaluate(set.objectSet);
      const link = LINKS.find(
        (l) => l.from === inner.type && l.apiName === set.link,
      );
      if (!link)
        throw notFound("LinkTypeNotFound", {
          objectType: inner.type,
          linkType: set.link,
        });
      const keys = new Set(inner.objects.map((o) => o[link.fromKey]));
      return {
        type: link.to,
        objects: TYPES[link.to].data.filter((o) => keys.has(o[link.toKey])),
      };
    }
    case "union":
    case "intersect":
    case "subtract": {
      const parts = set.objectSets.map(evaluate);
      const type = parts[0].type;
      const pk = TYPES[type].primaryKey;
      const keysOf = (part) => new Set(part.objects.map((o) => o[pk]));
      let objects = parts[0].objects;
      for (const part of parts.slice(1)) {
        const keys = keysOf(part);
        if (set.type === "union")
          objects = [
            ...objects,
            ...part.objects.filter(
              (o) => !objects.some((x) => x[pk] === o[pk]),
            ),
          ];
        if (set.type === "intersect")
          objects = objects.filter((o) => keys.has(o[pk]));
        if (set.type === "subtract")
          objects = objects.filter((o) => !keys.has(o[pk]));
      }
      return { type, objects };
    }
    default:
      throw httpError(
        400,
        "INVALID_ARGUMENT",
        "InvalidObjectSet",
        `Unsupported object set ${set.type}`,
      );
  }
}

function wireObject(type, object, select, includeRid) {
  const meta = TYPES[type];
  const props = select?.length ? select : Object.keys(meta.properties);
  const out = {
    __apiName: type,
    __primaryKey: object[meta.primaryKey],
    __title: object[meta.titleProperty],
    ...(includeRid ? { __rid: objectRid(type, object[meta.primaryKey]) } : {}),
  };
  for (const key of props) {
    if (object[key] !== null && object[key] !== undefined)
      out[key] = object[key];
  }
  return out;
}

function loadObjects(body) {
  const { type, objects } = evaluate(body.objectSet);
  let list = [...objects];
  for (const field of [...(body.orderBy?.fields ?? [])].reverse()) {
    const dir = field.direction === "desc" ? -1 : 1;
    list.sort((a, b) =>
      a[field.field] === b[field.field]
        ? 0
        : a[field.field] > b[field.field]
          ? dir
          : -dir,
    );
  }
  const size = Math.min(body.pageSize ?? 1000, 10000);
  const offset = Number(body.pageToken ?? 0);
  const page = list.slice(offset, offset + size);
  const select = [
    ...(body.select ?? []),
    ...(body.selectV2 ?? []).map(
      (item) => item.apiName ?? item.propertyIdentifier?.apiName,
    ),
  ].filter(Boolean);
  return {
    data: page.map((o) => wireObject(type, o, select, !body.excludeRid)),
    nextPageToken:
      offset + size < list.length ? String(offset + size) : undefined,
    totalCount: String(list.length),
    propertySecurities: [],
  };
}

function metricValue(metric, objects) {
  if (metric.type === "count") return objects.length;
  const values = objects
    .map((o) => o[metric.field])
    .filter((v) => v !== null && v !== undefined);
  switch (metric.type) {
    case "sum":
      return Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
    case "avg":
      return values.length
        ? Math.round(
            (values.reduce((a, b) => a + b, 0) / values.length) * 1000,
          ) / 1000
        : undefined;
    case "min":
      return values.length
        ? values.reduce((a, b) => (b < a ? b : a))
        : undefined;
    case "max":
      return values.length
        ? values.reduce((a, b) => (b > a ? b : a))
        : undefined;
    case "approximateDistinct":
    case "exactDistinct":
      return new Set(values).size;
    default:
      throw httpError(
        400,
        "INVALID_ARGUMENT",
        "InvalidAggregation",
        `Unsupported metric ${metric.type}`,
      );
  }
}

function bucketKey(group, object) {
  const value = object[group.field];
  switch (group.type) {
    case "exact":
      return value ?? null;
    case "fixedWidth":
      return value === null || value === undefined
        ? null
        : Math.floor(value / group.fixedWidth) * group.fixedWidth;
    case "ranges": {
      const range = group.ranges.find(
        (r) =>
          (r.startValue == null || value >= r.startValue) &&
          (r.endValue == null || value < r.endValue),
      );
      return range
        ? { startValue: range.startValue, endValue: range.endValue }
        : undefined;
    }
    case "duration": {
      // Dates bucketed by month or day; enough for the mock.
      if (!value) return null;
      return /month/i.test(group.unit)
        ? `${String(value).slice(0, 7)}-01`
        : String(value).slice(0, 10);
    }
    default:
      throw httpError(
        400,
        "INVALID_ARGUMENT",
        "InvalidAggregation",
        `Unsupported group by ${group.type}`,
      );
  }
}

function aggregate(body) {
  const { type, objects } = evaluate(body.objectSet);
  for (const metric of body.aggregation ?? []) {
    if (metric.field && !(metric.field in TYPES[type].properties)) {
      throw httpError(
        400,
        "INVALID_ARGUMENT",
        "PropertiesNotFound",
        `Unknown property ${metric.field}`,
      );
    }
  }
  const metrics = (list) =>
    (body.aggregation ?? [])
      .map((metric) => ({
        name: metric.name,
        value: metricValue(metric, list),
      }))
      .filter((m) => m.value !== undefined);
  const groups = body.groupBy ?? [];
  if (!groups.length)
    return {
      accuracy: "ACCURATE",
      data: [{ group: {}, metrics: metrics(objects) }],
    };
  const buckets = new Map();
  for (const object of objects) {
    const keys = groups.map((group) => bucketKey(group, object));
    if (keys.some((key) => key === undefined)) continue;
    const id = JSON.stringify(keys);
    if (!buckets.has(id)) buckets.set(id, { keys, objects: [] });
    buckets.get(id).objects.push(object);
  }
  let data = [...buckets.values()].map((bucket) => ({
    group: Object.fromEntries(
      groups.map((group, i) => [group.field, bucket.keys[i]]),
    ),
    metrics: metrics(bucket.objects),
  }));
  data.sort((a, b) => (b.metrics[0]?.value ?? 0) - (a.metrics[0]?.value ?? 0));
  const limit = groups[0].maxGroupCount;
  if (limit) data = data.slice(0, limit);
  return { accuracy: "ACCURATE", data };
}

function riskScore(supplierId) {
  const supplier = SUPPLIERS.find((s) => s.supplierId === supplierId);
  if (!supplier)
    throw httpError(
      400,
      "INVALID_ARGUMENT",
      "QueryRuntimeError",
      `Unknown supplier ${supplierId}`,
    );
  const orders = ORDERS.filter((o) => o.supplierId === supplierId);
  const delayRate = orders.length
    ? orders.filter((o) => o.status === "延误").length / orders.length
    : 0;
  const weight = { 高: 1, 中: 0.5, 低: 0.2 };
  const incidents = INCIDENTS.filter((i) => i.supplierId === supplierId).reduce(
    (sum, i) => sum + weight[i.severity],
    0,
  );
  const rating = { A: 0, B: 0.5, C: 1 }[supplier.rating];
  return (
    Math.round(
      (0.45 * delayRate + 0.35 * Math.min(incidents / 3, 1) + 0.2 * rating) *
        1000,
    ) / 10
  );
}

function validateEscalation(parameters) {
  const order = ORDERS.find((o) => o.orderId === parameters.orderId);
  const priorityOk = ["高", "中", "低"].includes(parameters.priority);
  const arrived = order?.status === "已到货";
  const valid = Boolean(order) && priorityOk && !arrived;
  return {
    order,
    validation: {
      result: valid ? "VALID" : "INVALID",
      submissionCriteria: [
        ...(order
          ? []
          : [
              {
                result: "INVALID",
                configuredFailureMessage: `订单 ${parameters.orderId} 不存在`,
              },
            ]),
        ...(arrived
          ? [
              {
                result: "INVALID",
                configuredFailureMessage: "已到货的订单无需升级",
              },
            ]
          : []),
      ],
      parameters: {
        orderId: {
          result: order ? "VALID" : "INVALID",
          evaluatedConstraints: order ? [] : [{ type: "objectQueryResult" }],
          required: true,
        },
        priority: {
          result: priorityOk ? "VALID" : "INVALID",
          evaluatedConstraints: priorityOk ? [] : [{ type: "oneOf" }],
          required: true,
        },
        note: { result: "VALID", evaluatedConstraints: [], required: false },
      },
    },
  };
}

/* --------------------------------------------------------------- server */

function httpError(status, errorCode, errorName, message, parameters = {}) {
  return Object.assign(new Error(message), {
    status,
    body: {
      errorCode,
      errorName,
      errorInstanceId: randomUUID(),
      parameters,
      message,
    },
  });
}
const notFound = (errorName, parameters) =>
  httpError(404, "NOT_FOUND", errorName, `${errorName}`, parameters);

const page = (items, url) => {
  const size = Number(url.searchParams.get("pageSize") ?? 500);
  const offset = Number(url.searchParams.get("pageToken") ?? 0);
  return {
    data: items.slice(offset, offset + size),
    ...(offset + size < items.length
      ? { nextPageToken: String(offset + size) }
      : {}),
  };
};

async function route(req, url) {
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const body = req.method === "POST" ? await readBody(req) : undefined;

  if (url.pathname === "/multipass/api/oauth2/token") {
    const form = new URLSearchParams(typeof body === "string" ? body : "");
    const basic = req.headers.authorization?.startsWith("Basic ")
      ? Buffer.from(req.headers.authorization.slice(6), "base64")
          .toString()
          .split(":")
          .map(decodeURIComponent)
      : [];
    const id = form.get("client_id") ?? basic[0];
    const secret = form.get("client_secret") ?? basic[1];
    if (id !== CLIENT.id || secret !== CLIENT.secret) {
      return [401, { error: "invalid_client" }];
    }
    const token = `mock-${randomUUID()}`;
    issued.add(token);
    return [
      200,
      {
        access_token: token,
        token_type: "bearer",
        expires_in: 3600,
        scope: form.get("scope") ?? "",
      },
    ];
  }

  const auth = req.headers.authorization ?? "";
  if (!issued.has(auth.replace(/^Bearer\s+/i, ""))) {
    throw httpError(
      401,
      "UNAUTHORIZED",
      "MissingCredentials",
      "Invalid or missing token",
    );
  }

  // /api/v2/ontologies[...]
  if (parts[0] !== "api" || parts[1] !== "v2" || parts[2] !== "ontologies")
    throw notFound("NotFound", { path: url.pathname });
  if (parts.length === 3) return [200, { data: [ONTOLOGY] }];
  const ontology = parts[3];
  if (ontology !== ONTOLOGY.apiName && ontology !== ONTOLOGY.rid)
    throw notFound("OntologyNotFound", { ontology });
  const [, , , , section, name, sub, more] = parts;
  if (!section) return [200, ONTOLOGY];

  if (section === "objectTypes") {
    if (!name) return [200, page(Object.keys(TYPES).map(objectTypeV2), url)];
    if (!TYPES[name])
      throw notFound("ObjectTypeNotFound", { objectType: name });
    if (!sub) return [200, objectTypeV2(name)];
    if (sub === "fullMetadata") {
      return [
        200,
        {
          objectType: objectTypeV2(name),
          linkTypes: LINKS.filter((l) => l.from === name).map(linkSide),
          implementsInterfaces: [],
          implementsInterfaces2: {},
          sharedPropertyTypeMapping: {},
        },
      ];
    }
    if (sub === "outgoingLinkTypes") {
      const links = LINKS.filter((l) => l.from === name).map(linkSide);
      return [
        200,
        more ? links.find((l) => l.apiName === more) : page(links, url),
      ];
    }
  }
  if (section === "objectSets" && name === "loadObjects")
    return [200, loadObjects(body)];
  if (section === "objectSets" && name === "loadObjectsMultipleObjectTypes") {
    return [
      200,
      {
        ...loadObjects(body),
        interfaceToObjectTypeMappings: {},
        interfaceToObjectTypeMappingsV2: {},
      },
    ];
  }
  if (section === "objectSets" && name === "aggregate")
    return [200, aggregate(body)];
  if (section === "queryTypes") {
    if (!name) return [200, page(Object.values(QUERIES), url)];
    if (!QUERIES[name]) throw notFound("QueryNotFound", { query: name });
    return [200, QUERIES[name]];
  }
  if (section === "queries" && sub === "execute") {
    if (name !== "supplierRiskScore")
      throw notFound("QueryNotFound", { query: name });
    return [200, { value: riskScore(body.parameters?.supplierId) }];
  }
  if (section === "actionTypes") {
    if (!name) return [200, page(Object.values(ACTIONS), url)];
    if (!ACTIONS[name])
      throw notFound("ActionTypeNotFound", { actionType: name });
    return [200, ACTIONS[name]];
  }
  if (section === "actions" && sub === "apply") {
    if (name !== "escalateOrder")
      throw notFound("ActionTypeNotFound", { actionType: name });
    const { order, validation } = validateEscalation(body.parameters ?? {});
    if (
      body.options?.mode === "VALIDATE_ONLY" ||
      validation.result === "INVALID"
    ) {
      return [200, { validation }];
    }
    order.priority = body.parameters.priority;
    order.escalationNote = body.parameters.note ?? null;
    return [
      200,
      {
        validation,
        edits:
          body.options?.returnEdits && body.options.returnEdits !== "NONE"
            ? {
                type: "edits",
                edits: [
                  {
                    type: "modifyObject",
                    objectType: "PurchaseOrder",
                    primaryKey: order.orderId,
                  },
                ],
                addedObjectCount: 0,
                modifiedObjectsCount: 1,
                deletedObjectsCount: 0,
                addedLinksCount: 0,
                deletedLinksCount: 0,
              }
            : undefined,
      },
    ];
  }
  throw notFound("NotFound", { path: url.pathname });
}

async function readBody(req) {
  let text = "";
  for await (const chunk of req) text += chunk;
  if ((req.headers["content-type"] ?? "").includes("application/json")) {
    return text ? JSON.parse(text) : {};
  }
  return text;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      const [status, payload] = await route(req, url);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    } catch (error) {
      const status = error.status ?? 500;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          error.body ?? {
            errorCode: "INTERNAL",
            errorName: "Internal",
            message: String(error),
            parameters: {},
          },
        ),
      );
      if (status >= 500) console.error(error);
    }
    if (process.env.MOCK_FOUNDRY_LOG)
      console.log(req.method, url.pathname, res.statusCode);
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(
      `Mock Foundry on http://127.0.0.1:${PORT} — ontology "${ONTOLOGY.apiName}", token "${TOKEN}"`,
    );
  });
