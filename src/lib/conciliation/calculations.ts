import type {
  ConciliationActor,
  ConciliationCalculationConditionOperator,
  ConciliationCalculationConditionalFormula,
  ConciliationCalculationInlineConditional,
  ConciliationCalculationInlineConditionOperator,
  ConciliationCalculationInteraction,
  ConciliationCalculationValue,
  ConciliationCustomCalculation,
  ConciliationOrder,
} from "@/types/conciliation";

export type ConciliationCalculationFieldId =
  | "grossRevenue"
  | "productRevenue"
  | "customerShippingRevenue"
  | "discountAmount"
  | "otherExpenses"
  | "netRevenue"
  | "productCost"
  | "shippingCost"
  | "commissionFee"
  | "taxes"
  | "contributionMargin"
  | "contributionMarginPercentage"
  | "totalQuantity"
  | "itemsCount"
  | "payoutPaidNetAmount"
  | "payoutDifferenceAmount"
  | "financialRiskAmount";

export type ConciliationCalculationFieldOption = {
  id: ConciliationCalculationFieldId;
  label: string;
  helper: string;
};

export type ConciliationCalculationConditionOperatorOption = {
  value: ConciliationCalculationConditionOperator;
  label: string;
};

export type ConciliationCalculationInlineConditionOperatorOption = {
  value: ConciliationCalculationInlineConditionOperator;
  label: string;
  needsValue: boolean;
};

type FormulaToken =
  | { type: "number"; value: number }
  | { type: "field"; value: string }
  | { type: "operator"; value: "+" | "-" | "*" | "/" }
  | { type: "open" }
  | { type: "close" };

export const conciliationCalculationFieldOptions: ConciliationCalculationFieldOption[] = [
  { id: "grossRevenue", label: "Faturamento bruto", helper: "Total do pedido" },
  { id: "productRevenue", label: "Produtos", helper: "Subtotal dos itens" },
  { id: "customerShippingRevenue", label: "Frete cliente", helper: "Frete cobrado" },
  { id: "discountAmount", label: "Desconto", helper: "Desconto aplicado" },
  { id: "otherExpenses", label: "Outras despesas", helper: "Despesas adicionais" },
  { id: "netRevenue", label: "Líquido estimado", helper: "Bruto menos deduções" },
  { id: "productCost", label: "Custo produto", helper: "CMV do pedido" },
  { id: "shippingCost", label: "Frete custo", helper: "Custo logístico" },
  { id: "commissionFee", label: "Comissão", helper: "Taxas do marketplace" },
  { id: "taxes", label: "Impostos", helper: "Tributos disponíveis" },
  { id: "contributionMargin", label: "Margem", helper: "Líquido menos custo" },
  { id: "contributionMarginPercentage", label: "Margem %", helper: "Percentual de margem" },
  { id: "totalQuantity", label: "Qtd pedido", helper: "Quantidade total" },
  { id: "itemsCount", label: "Qtd itens", helper: "Linhas de produto" },
  { id: "payoutPaidNetAmount", label: "Líquido repassado", helper: "Total importado do marketplace" },
  { id: "payoutDifferenceAmount", label: "Diferença repasse", helper: "Repassado menos esperado" },
  { id: "financialRiskAmount", label: "Risco financeiro", helper: "Impacto estimado dos alertas" },
];

const fieldIds = new Set<string>(conciliationCalculationFieldOptions.map((field) => field.id));

export const conciliationCalculationConditionOperatorOptions: ConciliationCalculationConditionOperatorOption[] = [
  { value: "equals", label: "Igual a" },
  { value: "notEquals", label: "Diferente de" },
  { value: "greaterThan", label: "Maior que" },
  { value: "greaterThanOrEqual", label: "Maior ou igual a" },
  { value: "lessThan", label: "Menor que" },
  { value: "lessThanOrEqual", label: "Menor ou igual a" },
];

const conditionOperators = new Set<ConciliationCalculationConditionOperator>(
  conciliationCalculationConditionOperatorOptions.map((operator) => operator.value)
);

export const conciliationCalculationInlineConditionOperatorOptions: ConciliationCalculationInlineConditionOperatorOption[] =
  [
    { value: "exists", label: "Existe", needsValue: false },
    { value: "notExists", label: "Não existe", needsValue: false },
    { value: "equals", label: "Igual a", needsValue: true },
    { value: "notEquals", label: "Diferente de", needsValue: true },
    { value: "greaterThan", label: "Maior que", needsValue: true },
    { value: "greaterThanOrEqual", label: "Maior ou igual a", needsValue: true },
    { value: "lessThan", label: "Menor que", needsValue: true },
    { value: "lessThanOrEqual", label: "Menor ou igual a", needsValue: true },
  ];

const inlineConditionOperators = new Set<ConciliationCalculationInlineConditionOperator>(
  conciliationCalculationInlineConditionOperatorOptions.map((operator) => operator.value)
);

export const sanitizeConciliationCalculationId = (value: string): string => {
  const normalized = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 48);

  return normalized ? `calc_${normalized}` : `calc_${Date.now().toString(36)}`;
};

const sanitizeConciliationConditionalFormulaId = (value: string, index: number): string => {
  const normalized = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 40);

  return normalized ? `cond_${normalized}` : `cond_${index + 1}`;
};

export const normalizeConciliationCalculationConditionalFormulas = (
  value: unknown
): ConciliationCalculationConditionalFormula[] => {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();

  return value.reduce<ConciliationCalculationConditionalFormula[]>((formulas, item, index) => {
    if (!item || typeof item !== "object") return formulas;

    const record = item as Partial<ConciliationCalculationConditionalFormula>;
    const fieldId = String(record.fieldId || "").trim();
    const operator = conditionOperators.has(record.operator as ConciliationCalculationConditionOperator)
      ? (record.operator as ConciliationCalculationConditionOperator)
      : "equals";
    const expression = String(record.expression || "").trim();
    const name = String(record.name || `Condição ${index + 1}`).trim();
    const id = String(record.id || sanitizeConciliationConditionalFormulaId(name, index)).trim();

    if (!fieldId || !expression || !id || seenIds.has(id)) return formulas;

    seenIds.add(id);
    formulas.push({
      id,
      name,
      fieldId,
      operator,
      value: String(record.value ?? "").trim(),
      expression,
    });

    return formulas;
  }, []);
};

const sanitizeConciliationInlineConditionalId = (value: string, index: number): string => {
  const normalized = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 40);

  return normalized ? `inline_${normalized}` : `inline_${index + 1}`;
};

export const normalizeConciliationCalculationInlineConditionals = (
  value: unknown
): ConciliationCalculationInlineConditional[] => {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();

  return value.reduce<ConciliationCalculationInlineConditional[]>((conditionals, item, index) => {
    if (!item || typeof item !== "object") return conditionals;

    const record = item as Partial<ConciliationCalculationInlineConditional>;
    const checkFieldId = String(record.checkFieldId || "").trim();
    const thenFieldId = String(record.thenFieldId || "").trim();
    const elseFieldId = String(record.elseFieldId || "").trim();
    const operator = inlineConditionOperators.has(record.operator as ConciliationCalculationInlineConditionOperator)
      ? (record.operator as ConciliationCalculationInlineConditionOperator)
      : "exists";
    const name = String(record.name || `Inline ${index + 1}`).trim();
    const id = String(record.id || sanitizeConciliationInlineConditionalId(name, index)).trim();

    if (!checkFieldId || !thenFieldId || !elseFieldId || !id || seenIds.has(id)) return conditionals;

    seenIds.add(id);
    conditionals.push({
      id,
      name,
      checkFieldId,
      operator,
      value: String(record.value ?? "").trim(),
      thenFieldId,
      elseFieldId,
    });

    return conditionals;
  }, []);
};

export const normalizeConciliationCalculationInteraction = (
  value: unknown
): ConciliationCalculationInteraction | null => {
  if (!value || typeof value !== "object") return null;

  const record = value as Partial<ConciliationCalculationInteraction>;
  const targetFieldId = String(record.targetFieldId || "").trim();
  const operator = record.operator === "+" ? "+" : "-";

  if (!targetFieldId || targetFieldId === "none") return null;

  return {
    targetFieldId,
    operator,
  };
};

export const normalizeConciliationCustomCalculations = (
  value: unknown,
  updatedAt: string | null = null,
  updatedBy: ConciliationActor | null = null
): ConciliationCustomCalculation[] => {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();

  return value.reduce<ConciliationCustomCalculation[]>((calculations, item) => {
    if (!item || typeof item !== "object") return calculations;

    const record = item as Partial<ConciliationCustomCalculation>;
    const name = String(record.name || "").trim();
    const expression = String(record.expression || "").trim();
    const id = String(record.id || sanitizeConciliationCalculationId(name)).trim();
    const marketplace = String(record.marketplace || "Todos").trim() || "Todos";
    const statusNames = Array.isArray(record.statusNames)
      ? Array.from(
          new Set(
            record.statusNames
              .map((statusName) => String(statusName || "").trim())
              .filter(Boolean)
          )
        )
      : [];

    if (!name || !expression || !id || seenIds.has(id)) return calculations;

    seenIds.add(id);
    calculations.push({
      id,
      name,
      description: String(record.description || "").trim(),
      expression,
      conditionalFormulas: normalizeConciliationCalculationConditionalFormulas(record.conditionalFormulas),
      inlineConditionals: normalizeConciliationCalculationInlineConditionals(record.inlineConditionals),
      interaction: normalizeConciliationCalculationInteraction(record.interaction),
      marketplace,
      statusNames,
      isPercentage: Boolean(record.isPercentage),
      enabled: record.enabled !== false,
      updatedAt: updatedAt ?? record.updatedAt ?? null,
      updatedBy: updatedBy ?? record.updatedBy ?? null,
    });

    return calculations;
  }, []);
};

const parseConciliationCalculationNumericValue = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value !== "string") return Number.NaN;

  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;

  const normalized = trimmed.includes(",") ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed;
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export const buildConciliationCalculationContext = (
  order: ConciliationOrder,
  previousValues: Record<string, number> = {}
): Record<string, number> => {
  const sheetValues = Object.entries(order.sheetFields || {}).reduce<Record<string, number>>((values, [key, value]) => {
    const numericValue = parseConciliationCalculationNumericValue(value);

    if (Number.isFinite(numericValue)) {
      values[`sheet:${key}`] = numericValue;
    }

    return values;
  }, {});

  return {
    grossRevenue: order.grossRevenue,
    productRevenue: order.productRevenue,
    customerShippingRevenue: order.customerShippingRevenue,
    discountAmount: order.discountAmount,
    otherExpenses: order.otherExpenses,
    netRevenue: order.netRevenue,
    productCost: order.productCost,
    shippingCost: order.shippingCost,
    commissionFee: order.commissionFee,
    taxes: order.taxes,
    contributionMargin: order.contributionMargin,
    contributionMarginPercentage: order.contributionMarginPercentage,
    totalQuantity: order.totalQuantity,
    itemsCount: order.items.length,
    payoutPaidNetAmount: order.payoutComparison.paidNetAmount,
    payoutDifferenceAmount: order.payoutComparison.differenceAmount,
    financialRiskAmount: order.financialDivergence.riskAmount,
    ...sheetValues,
    ...previousValues,
  };
};

const tokenizeExpression = (expression: string): FormulaToken[] => {
  const tokens: FormulaToken[] = [];
  let index = 0;

  while (index < expression.length) {
    const character = expression[index];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (/[0-9,.]/.test(character)) {
      let buffer = "";

      while (index < expression.length && /[0-9,.]/.test(expression[index])) {
        buffer += expression[index];
        index += 1;
      }

      const normalized = buffer.includes(",") ? buffer.replace(/\./g, "").replace(",", ".") : buffer;
      const value = Number(normalized);

      if (!Number.isFinite(value)) throw new Error(`Número inválido: ${buffer}`);
      tokens.push({ type: "number", value });
      continue;
    }

    if (character === "{") {
      const endIndex = expression.indexOf("}", index + 1);
      if (endIndex === -1) throw new Error("Campo sem fechamento: use {campo}.");
      const fieldId = expression.slice(index + 1, endIndex).trim();
      if (!fieldId) throw new Error("Campo vazio na fórmula.");
      tokens.push({ type: "field", value: fieldId });
      index = endIndex + 1;
      continue;
    }

    if (/[a-zA-Z_]/.test(character)) {
      let fieldId = "";

      while (index < expression.length && /[a-zA-Z0-9_]/.test(expression[index])) {
        fieldId += expression[index];
        index += 1;
      }

      tokens.push({ type: "field", value: fieldId });
      continue;
    }

    if (character === "+" || character === "-" || character === "*" || character === "/") {
      tokens.push({ type: "operator", value: character });
      index += 1;
      continue;
    }

    if (character === "(") {
      tokens.push({ type: "open" });
      index += 1;
      continue;
    }

    if (character === ")") {
      tokens.push({ type: "close" });
      index += 1;
      continue;
    }

    throw new Error(`Caractere não permitido na fórmula: ${character}`);
  }

  return tokens;
};

export const evaluateConciliationCalculationExpression = (
  expression: string,
  context: Record<string, number>
): { value: number; error: string | null } => {
  try {
    const tokens = tokenizeExpression(expression);
    let cursor = 0;

    if (tokens.length === 0) return { value: 0, error: "Fórmula vazia." };

    const parseExpression = (): number => {
      let value = parseTerm();

      while (true) {
        const token = tokens[cursor];
        if (token?.type !== "operator" || (token.value !== "+" && token.value !== "-")) break;

        const operator = token.value;
        cursor += 1;
        const right = parseTerm();
        value = operator === "+" ? value + right : value - right;
      }

      return value;
    };

    const parseTerm = (): number => {
      let value = parseFactor();

      while (true) {
        const token = tokens[cursor];
        if (token?.type !== "operator" || (token.value !== "*" && token.value !== "/")) break;

        const operator = token.value;
        cursor += 1;
        const right = parseFactor();

        if (operator === "/" && Math.abs(right) < 0.0000001) throw new Error("Divisão por zero.");
        value = operator === "*" ? value * right : value / right;
      }

      return value;
    };

    const parseFactor = (): number => {
      const token = tokens[cursor];
      if (!token) throw new Error("Fórmula incompleta.");

      if (token.type === "operator" && (token.value === "+" || token.value === "-")) {
        cursor += 1;
        const value = parseFactor();
        return token.value === "-" ? -value : value;
      }

      if (token.type === "number") {
        cursor += 1;
        return token.value;
      }

      if (token.type === "field") {
        cursor += 1;

        if (!(token.value in context)) throw new Error(`Campo não encontrado: ${token.value}`);
        return Number.isFinite(context[token.value]) ? context[token.value] : 0;
      }

      if (token.type === "open") {
        cursor += 1;
        const value = parseExpression();

        if (tokens[cursor]?.type !== "close") throw new Error("Parêntese sem fechamento.");
        cursor += 1;
        return value;
      }

      throw new Error("Operador em posição inválida.");
    };

    const value = parseExpression();

    if (cursor < tokens.length) throw new Error("Fórmula possui termos extras.");

    return {
      value: Number.isFinite(value) ? value : 0,
      error: null,
    };
  } catch (error) {
    return {
      value: 0,
      error: error instanceof Error ? error.message : "Não foi possível avaliar a fórmula.",
    };
  }
};

export const validateConciliationCalculationExpression = (
  expression: string,
  extraFields: string[] = []
): string | null => {
  const context = [...fieldIds, ...extraFields].reduce<Record<string, number>>((values, fieldId) => {
    values[fieldId] = 1;
    return values;
  }, {});
  const result = evaluateConciliationCalculationExpression(expression, context);

  return result.error;
};

const parseConditionNumericValue = (value: string): number => {
  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;

  const normalized = trimmed.includes(",") ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed;
  return Number(normalized);
};

const compareConciliationCondition = (
  left: number,
  operator: ConciliationCalculationConditionOperator,
  rawRight: string
) => {
  const right = parseConditionNumericValue(rawRight);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;

  switch (operator) {
    case "equals":
      return Math.abs(left - right) < 0.0000001;
    case "notEquals":
      return Math.abs(left - right) >= 0.0000001;
    case "greaterThan":
      return left > right;
    case "greaterThanOrEqual":
      return left >= right;
    case "lessThan":
      return left < right;
    case "lessThanOrEqual":
      return left <= right;
    default:
      return false;
  }
};

const compareConciliationInlineCondition = (
  context: Record<string, number>,
  conditional: ConciliationCalculationInlineConditional
) => {
  const left = context[conditional.checkFieldId];
  const fieldExists = conditional.checkFieldId in context && Number.isFinite(left);

  if (conditional.operator === "exists") return fieldExists;
  if (conditional.operator === "notExists") return !fieldExists;
  if (!fieldExists) return false;

  return compareConciliationCondition(left, conditional.operator, conditional.value);
};

export const resolveConciliationInlineConditionalValues = (
  calculation: Pick<ConciliationCustomCalculation, "inlineConditionals">,
  context: Record<string, number>
): Record<string, number> =>
  (calculation.inlineConditionals || []).reduce<Record<string, number>>((values, conditional) => {
    const pickedThen = compareConciliationInlineCondition(context, conditional);
    const fieldId = pickedThen ? conditional.thenFieldId : conditional.elseFieldId;
    const resolvedValue = context[fieldId];

    values[conditional.id] = Number.isFinite(resolvedValue) ? resolvedValue : 0;

    return values;
  }, {});

export const buildConciliationCalculationEvaluationContext = (
  calculation: Pick<ConciliationCustomCalculation, "inlineConditionals">,
  context: Record<string, number>
): Record<string, number> => ({
  ...context,
  ...resolveConciliationInlineConditionalValues(calculation, context),
});

export const resolveConciliationCalculationExpression = (
  calculation: Pick<ConciliationCustomCalculation, "expression" | "conditionalFormulas">,
  context: Record<string, number>
): {
  expression: string;
  conditionalFormula: ConciliationCalculationConditionalFormula | null;
} => {
  const conditionalFormula =
    (calculation.conditionalFormulas || []).find((formula) =>
      compareConciliationCondition(context[formula.fieldId], formula.operator, formula.value)
    ) ?? null;

  return {
    expression: conditionalFormula?.expression || calculation.expression,
    conditionalFormula,
  };
};

export const isConciliationCalculationApplicableToOrder = (
  calculation: Pick<ConciliationCustomCalculation, "marketplace" | "statusNames">,
  order: ConciliationOrder
) => {
  const marketplace = String(calculation.marketplace || "Todos").trim();
  const statusNames = Array.isArray(calculation.statusNames) ? calculation.statusNames : [];

  if (marketplace && marketplace !== "Todos" && order.marketplace !== marketplace) {
    return false;
  }

  if (statusNames.length > 0 && !statusNames.includes(order.statusName)) {
    return false;
  }

  return true;
};

const mutableOrderCalculationFieldIds = new Set<string>([
  "grossRevenue",
  "productRevenue",
  "customerShippingRevenue",
  "discountAmount",
  "otherExpenses",
  "netRevenue",
  "productCost",
  "shippingCost",
  "commissionFee",
  "taxes",
  "contributionMargin",
  "contributionMarginPercentage",
  "totalQuantity",
]);

const applyConciliationCalculationInteraction = ({
  order,
  numericResults,
  values,
  interaction,
  calculationValue,
}: {
  order: ConciliationOrder;
  numericResults: Record<string, number>;
  values: Record<string, ConciliationCalculationValue>;
  interaction: ConciliationCalculationInteraction | null;
  calculationValue: number;
}) => {
  if (!interaction?.targetFieldId) return;

  const baseValue = numericResults[interaction.targetFieldId];
  const fallbackValue = buildConciliationCalculationContext(order, numericResults)[interaction.targetFieldId];
  const resolvedBaseValue = Number.isFinite(baseValue) ? baseValue : fallbackValue;
  const nextValue =
    interaction.operator === "+"
      ? (Number.isFinite(resolvedBaseValue) ? resolvedBaseValue : 0) + calculationValue
      : (Number.isFinite(resolvedBaseValue) ? resolvedBaseValue : 0) - calculationValue;
  const safeValue = Number.isFinite(nextValue) ? nextValue : 0;

  numericResults[interaction.targetFieldId] = safeValue;

  if (values[interaction.targetFieldId]) {
    values[interaction.targetFieldId] = {
      ...values[interaction.targetFieldId],
      value: safeValue,
    };
  }

  if (mutableOrderCalculationFieldIds.has(interaction.targetFieldId)) {
    (order as unknown as Record<string, unknown>)[interaction.targetFieldId] = safeValue;
  }
};

export const applyConciliationCustomCalculations = (
  orders: ConciliationOrder[],
  calculations: ConciliationCustomCalculation[]
): ConciliationOrder[] => {
  const enabledCalculations = calculations.filter((calculation) => calculation.enabled);

  if (enabledCalculations.length === 0) {
    return orders.map((order) =>
      Object.keys(order.calculationValues).length === 0 ? order : { ...order, calculationValues: {} }
    );
  }

  return orders.map((order) => {
    const workingOrder: ConciliationOrder = { ...order };
    const numericResults: Record<string, number> = {};
    const calculationValues = enabledCalculations.reduce<Record<string, ConciliationCalculationValue>>(
      (values, calculation) => {
        if (!isConciliationCalculationApplicableToOrder(calculation, workingOrder)) {
          return values;
        }

        const baseContext = buildConciliationCalculationContext(workingOrder, numericResults);
        const context = buildConciliationCalculationEvaluationContext(calculation, baseContext);
        const resolvedExpression = resolveConciliationCalculationExpression(calculation, context);
        const result = evaluateConciliationCalculationExpression(resolvedExpression.expression, context);

        numericResults[calculation.id] = result.value;
        values[calculation.id] = {
          id: calculation.id,
          name: calculation.name,
          description: calculation.description,
          expression: resolvedExpression.expression,
          value: result.value,
          isPercentage: calculation.isPercentage,
          error: result.error,
        };

        if (!result.error) {
          applyConciliationCalculationInteraction({
            order: workingOrder,
            numericResults,
            values,
            interaction: calculation.interaction,
            calculationValue: result.value,
          });
        }

        return values;
      },
      {}
    );

    return {
      ...workingOrder,
      calculationValues,
    };
  });
};
