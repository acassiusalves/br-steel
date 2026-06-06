import type {
  ConciliationActor,
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

    if (!name || !expression || !id || seenIds.has(id)) return calculations;

    seenIds.add(id);
    calculations.push({
      id,
      name,
      description: String(record.description || "").trim(),
      expression,
      isPercentage: Boolean(record.isPercentage),
      enabled: record.enabled !== false,
      updatedAt: updatedAt ?? record.updatedAt ?? null,
      updatedBy: updatedBy ?? record.updatedBy ?? null,
    });

    return calculations;
  }, []);
};

export const buildConciliationCalculationContext = (
  order: ConciliationOrder,
  previousValues: Record<string, number> = {}
): Record<string, number> => ({
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
  ...previousValues,
});

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
    const numericResults: Record<string, number> = {};
    const calculationValues = enabledCalculations.reduce<Record<string, ConciliationCalculationValue>>(
      (values, calculation) => {
        const result = evaluateConciliationCalculationExpression(
          calculation.expression,
          buildConciliationCalculationContext(order, numericResults)
        );

        numericResults[calculation.id] = result.value;
        values[calculation.id] = {
          id: calculation.id,
          name: calculation.name,
          description: calculation.description,
          expression: calculation.expression,
          value: result.value,
          isPercentage: calculation.isPercentage,
          error: result.error,
        };

        return values;
      },
      {}
    );

    return {
      ...order,
      calculationValues,
    };
  });
};
