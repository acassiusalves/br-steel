import { gunzipSync } from 'zlib';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { SaleOrder } from '@/types/sale-order';

const BLING_API_BASE = 'https://api.bling.com.br/Api/v3';
const MAX_XML_TEXT_CHARS = 700_000;

export type BlingApiFetch = (url: string, init?: RequestInit) => Promise<any>;

export type InvoiceEnrichmentStats = {
  invoiceDetailsFetched: number;
  invoiceXmlFetched: number;
  invoiceXmlExisting: number;
  invoiceSkipped: number;
  invoiceErrors: number;
  invoiceXmlErrors: number;
};

export type InvoiceEnrichmentOptions = {
  fetchXml?: boolean;
  skipExistingXml?: boolean;
  source?: string;
};

type InvoiceSummary = {
  id: number;
  numero?: string;
  serie?: number;
  situacao?: number;
  tipo?: number;
  finalidade?: number;
  chaveAcesso?: string;
  dataEmissao?: string;
  dataOperacao?: string;
  valorNota?: number;
  valorFrete?: number;
  linkDanfe?: string;
  linkPDF?: string;
  numeroPedidoLoja?: string;
};

type XmlFetchResult = {
  fetched: boolean;
  existing: boolean;
  error?: string;
  payload?: Record<string, any>;
};

export function createInvoiceEnrichmentStats(): InvoiceEnrichmentStats {
  return {
    invoiceDetailsFetched: 0,
    invoiceXmlFetched: 0,
    invoiceXmlExisting: 0,
    invoiceSkipped: 0,
    invoiceErrors: 0,
    invoiceXmlErrors: 0,
  };
}

export function mergeInvoiceEnrichmentStats(
  target: InvoiceEnrichmentStats,
  source: Partial<InvoiceEnrichmentStats>
): InvoiceEnrichmentStats {
  target.invoiceDetailsFetched += source.invoiceDetailsFetched || 0;
  target.invoiceXmlFetched += source.invoiceXmlFetched || 0;
  target.invoiceXmlExisting += source.invoiceXmlExisting || 0;
  target.invoiceSkipped += source.invoiceSkipped || 0;
  target.invoiceErrors += source.invoiceErrors || 0;
  target.invoiceXmlErrors += source.invoiceXmlErrors || 0;
  return target;
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T;
  }

  if (value && typeof value === 'object') {
    const clean: Record<string, any> = {};
    for (const [key, item] of Object.entries(value as Record<string, any>)) {
      if (item !== undefined) {
        clean[key] = stripUndefined(item);
      }
    }
    return clean as T;
  }

  return value;
}

function limitError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

function getInvoiceId(order: SaleOrder | any): number | null {
  const rawId = Number(order?.notaFiscal?.id || 0);
  return Number.isFinite(rawId) && rawId > 0 ? rawId : null;
}

function toNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function buildInvoiceSummary(invoice: any, fallbackId: number): InvoiceSummary {
  return stripUndefined({
    id: toNumber(invoice?.id) || fallbackId,
    numero: invoice?.numero != null ? String(invoice.numero) : undefined,
    serie: toNumber(invoice?.serie),
    situacao: toNumber(invoice?.situacao),
    tipo: toNumber(invoice?.tipo),
    finalidade: toNumber(invoice?.finalidade),
    chaveAcesso: invoice?.chaveAcesso ? String(invoice.chaveAcesso) : undefined,
    dataEmissao: invoice?.dataEmissao ? String(invoice.dataEmissao) : undefined,
    dataOperacao: invoice?.dataOperacao ? String(invoice.dataOperacao) : undefined,
    valorNota: toNumber(invoice?.valorNota),
    valorFrete: toNumber(invoice?.valorFrete),
    linkDanfe: invoice?.linkDanfe ? String(invoice.linkDanfe) : undefined,
    linkPDF: invoice?.linkPDF ? String(invoice.linkPDF) : undefined,
    numeroPedidoLoja: invoice?.numeroPedidoLoja ? String(invoice.numeroPedidoLoja) : undefined,
  });
}

function sanitizeInvoiceData(invoice: any): any {
  if (!invoice || typeof invoice !== 'object' || Array.isArray(invoice)) {
    return invoice;
  }

  const { xml, ...rest } = invoice;
  return stripUndefined(rest);
}

function getExistingXmlInfo(data: any): boolean {
  return Boolean(
    data?.xml?.xmlText ||
    data?.xml?.gzipBase64 ||
    data?.xml?.storedCompressedBase64
  );
}

async function fetchInvoiceXml(
  blingFetch: BlingApiFetch,
  chaveAcesso: string,
  existingFiscalDocument: any | null
): Promise<XmlFetchResult> {
  if (existingFiscalDocument && getExistingXmlInfo(existingFiscalDocument)) {
    return { fetched: false, existing: true };
  }

  try {
    const url = `${BLING_API_BASE}/nfe/documento/${encodeURIComponent(chaveAcesso)}?formato=xml`;
    const response = await blingFetch(url);
    const documents = Array.isArray(response?.data)
      ? response.data
      : response?.data
        ? [response.data]
        : [];
    const xmlDocument = documents.find((item: any) => item?.conteudo) || null;

    if (!xmlDocument?.conteudo) {
      return {
        fetched: false,
        existing: false,
        error: 'Documento XML não retornado pelo Bling.',
      };
    }

    const compressed = Buffer.from(String(xmlDocument.conteudo), 'base64');
    const xmlText = gunzipSync(compressed).toString('utf8');
    const storeXmlText = xmlText.length <= MAX_XML_TEXT_CHARS;

    return {
      fetched: true,
      existing: false,
      payload: stripUndefined({
        nome: xmlDocument.nome ? String(xmlDocument.nome) : undefined,
        fetchedAt: new Date().toISOString(),
        compressedBytes: compressed.byteLength,
        xmlTextBytes: Buffer.byteLength(xmlText, 'utf8'),
        xmlText: storeXmlText ? xmlText : undefined,
        gzipBase64: storeXmlText ? undefined : String(xmlDocument.conteudo),
        storedAs: storeXmlText ? 'xmlText' : 'gzipBase64',
      }),
    };
  } catch (error) {
    return {
      fetched: false,
      existing: false,
      error: limitError(error),
    };
  }
}

export async function enrichOrderWithInvoice(
  order: SaleOrder | any,
  blingFetch: BlingApiFetch,
  options: InvoiceEnrichmentOptions = {}
): Promise<{ order: any; stats: InvoiceEnrichmentStats }> {
  const stats = createInvoiceEnrichmentStats();
  const invoiceId = getInvoiceId(order);

  if (!invoiceId) {
    stats.invoiceSkipped += 1;
    return { order, stats };
  }

  const now = new Date().toISOString();
  const fiscalDocRef = doc(db, 'fiscalDocuments', String(invoiceId));
  let existingFiscalDocument: any | null = null;

  if (options.skipExistingXml || options.fetchXml) {
    const existingSnap = await getDoc(fiscalDocRef).catch(() => null);
    existingFiscalDocument = existingSnap?.exists() ? existingSnap.data() : null;
  }

  try {
    const invoiceResponse = await blingFetch(`${BLING_API_BASE}/nfe/${invoiceId}`);
    const invoiceData = invoiceResponse?.data;

    if (!invoiceData) {
      throw new Error('Resposta da NF-e sem dados.');
    }

    const summary = buildInvoiceSummary(invoiceData, invoiceId);
    let xmlResult: XmlFetchResult | null = null;

    if (options.fetchXml && summary.chaveAcesso) {
      xmlResult = await fetchInvoiceXml(blingFetch, summary.chaveAcesso, existingFiscalDocument);
      if (xmlResult.fetched) stats.invoiceXmlFetched += 1;
      if (xmlResult.existing) stats.invoiceXmlExisting += 1;
      if (xmlResult.error) stats.invoiceXmlErrors += 1;
    }

    await setDoc(
      fiscalDocRef,
      stripUndefined({
        invoiceId,
        orderId: order?.id ?? null,
        source: options.source || 'bling-sync',
        fetchedAt: now,
        updatedAt: now,
        summary,
        blingInvoiceData: sanitizeInvoiceData(invoiceData),
        xml: xmlResult?.payload,
        xmlError: xmlResult?.error,
      }),
      { merge: true }
    );

    stats.invoiceDetailsFetched += 1;

    return {
      order: stripUndefined({
        ...order,
        notaFiscal: {
          ...(order?.notaFiscal || {}),
          ...summary,
          id: invoiceId,
          hasFiscalDetails: true,
          fiscalDetailsFetchedAt: now,
          fiscalDocumentRef: `fiscalDocuments/${invoiceId}`,
          xmlAvailable: Boolean(xmlResult?.fetched || xmlResult?.existing || existingFiscalDocument?.xml),
          xmlFetchedAt: xmlResult?.fetched ? now : order?.notaFiscal?.xmlFetchedAt,
          xmlFetchError: xmlResult?.error,
        },
      }),
      stats,
    };
  } catch (error) {
    stats.invoiceErrors += 1;

    return {
      order: stripUndefined({
        ...order,
        notaFiscal: {
          ...(order?.notaFiscal || {}),
          id: invoiceId,
          hasFiscalDetails: false,
          fiscalDetailsError: limitError(error),
          fiscalDetailsFetchedAt: now,
        },
      }),
      stats,
    };
  }
}
