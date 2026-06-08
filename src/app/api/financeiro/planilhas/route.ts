import { NextResponse } from "next/server";

import { adminDb } from "@/lib/firebase-admin";
import { requirePagePermission } from "@/lib/server-auth";
import { defaultPlanilhaCategories, defaultPlanilhaTemplates } from "@/lib/conciliation/planilhas";
import type {
  ConciliationImportCategory,
  ConciliationImportFileRecord,
  ConciliationImportTemplate,
  ConciliationSheetAssociation,
} from "@/types/conciliation-planilhas";

export const dynamic = "force-dynamic";

const filesCollection = "conciliationImportFiles";
const associationsCollection = "conciliationAssociations";
const categoriesCollection = "conciliationCategories";
const templatesCollection = "conciliationTemplates";
const pagePath = "/financeiro/planilhas";
const maxBatchSize = 450;

const nowIso = () => new Date().toISOString();

const sanitizeId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 900);

const toActor = (user: { id: string; name: string; email: string }) => ({
  id: user.id,
  name: user.name,
  email: user.email,
});

async function deleteAssociationsByFileId(fileId: string): Promise<number> {
  let deleted = 0;

  // Loop em páginas para respeitar o limite de batch.
  for (;;) {
    const snapshot = await adminDb
      .collection(associationsCollection)
      .where("fileId", "==", fileId)
      .limit(maxBatchSize)
      .get();

    if (snapshot.empty) break;

    const batch = adminDb.batch();

    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snapshot.size;

    if (snapshot.size < maxBatchSize) break;
  }

  return deleted;
}

async function loadCategories(): Promise<ConciliationImportCategory[]> {
  const snapshot = await adminDb.collection(categoriesCollection).get();

  if (!snapshot.empty) {
    return snapshot.docs
      .map((doc) => doc.data() as ConciliationImportCategory)
      .sort((first, second) => first.sortOrder - second.sortOrder || first.name.localeCompare(second.name));
  }

  // Seed das categorias padrão na primeira utilização.
  const batch = adminDb.batch();
  const seeded: ConciliationImportCategory[] = defaultPlanilhaCategories.map((category) => ({
    id: `cat_${category.slug}`,
    name: category.name,
    slug: category.slug,
    color: category.color,
    icon: category.icon,
    sortOrder: category.sortOrder,
    usageCount: 0,
    isDefault: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }));

  seeded.forEach((category) => {
    batch.set(adminDb.collection(categoriesCollection).doc(category.id), category);
  });
  await batch.commit();

  return seeded;
}

async function loadTemplates(): Promise<ConciliationImportTemplate[]> {
  const snapshot = await adminDb.collection(templatesCollection).get();
  const stored = snapshot.docs.map((doc) => doc.data() as ConciliationImportTemplate);
  const storedIds = new Set(stored.map((template) => template.id));
  const merged = [
    ...stored,
    ...defaultPlanilhaTemplates.filter((template) => !storedIds.has(template.id)),
  ];

  return merged.sort((first, second) => first.name.localeCompare(second.name));
}

export async function GET(request: Request) {
  const permission = await requirePagePermission(request, pagePath);
  if (!permission.ok) return permission.response;

  try {
    const url = new URL(request.url);
    const monthsParam = url.searchParams.get("months");

    if (monthsParam !== null) {
      // Associações para a página de conciliação: filtradas por meses da venda
      // + todas as associações por SKU (custos valem para qualquer período).
      const months = monthsParam
        .split(",")
        .map((month) => month.trim())
        .filter((month) => /^\d{4}-\d{2}$/.test(month))
        .slice(0, 24);

      const queries = [
        adminDb.collection(associationsCollection).where("targetField", "==", "sku").get(),
      ];

      for (let index = 0; index < months.length; index += 30) {
        queries.push(
          adminDb
            .collection(associationsCollection)
            .where("saleMonth", "in", months.slice(index, index + 30))
            .get()
        );
      }

      const snapshots = await Promise.all(queries);
      const byId = new Map<string, ConciliationSheetAssociation>();

      snapshots.forEach((snapshot) => {
        snapshot.docs.forEach((doc) => {
          byId.set(doc.id, doc.data() as ConciliationSheetAssociation);
        });
      });

      return NextResponse.json({ ok: true, associations: Array.from(byId.values()) });
    }

    const [filesSnapshot, categories, templates] = await Promise.all([
      adminDb.collection(filesCollection).orderBy("createdAt", "desc").limit(200).get(),
      loadCategories(),
      loadTemplates(),
    ]);

    return NextResponse.json({
      ok: true,
      files: filesSnapshot.docs.map((doc) => doc.data() as ConciliationImportFileRecord),
      categories,
      templates,
    });
  } catch (error) {
    console.error("Erro ao carregar planilhas:", error);
    return NextResponse.json(
      { ok: false, error: "Não foi possível carregar as planilhas." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const permission = await requirePagePermission(request, pagePath);
  if (!permission.ok) return permission.response;

  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const actor = toActor(permission.user);

  try {
    if (action === "createImportFile") {
      const record = body.record as ConciliationImportFileRecord | undefined;

      if (!record?.fileName || !record?.marketplace || !/^\d{4}-\d{2}$/.test(record?.referenceMonth || "")) {
        return NextResponse.json({ ok: false, error: "invalid_record" }, { status: 400 });
      }

      const fileId = `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const stored: ConciliationImportFileRecord = {
        ...record,
        id: fileId,
        status: "processing",
        importedBy: actor,
        reprocessCount: record.reprocessCount ?? 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      await adminDb.collection(filesCollection).doc(fileId).set(stored);

      return NextResponse.json({ ok: true, fileId, record: stored });
    }

    if (action === "saveAssociations") {
      const fileId = typeof body.fileId === "string" ? body.fileId : "";
      const associations = Array.isArray(body.associations)
        ? (body.associations as ConciliationSheetAssociation[])
        : [];

      if (!fileId || associations.length === 0 || associations.length > maxBatchSize) {
        return NextResponse.json({ ok: false, error: "invalid_associations" }, { status: 400 });
      }

      const batch = adminDb.batch();

      associations.forEach((association) => {
        const id = sanitizeId(`${fileId}_${association.orderKey}`);

        batch.set(adminDb.collection(associationsCollection).doc(id), {
          ...association,
          id,
          fileId,
          createdAt: association.createdAt ?? nowIso(),
          updatedAt: nowIso(),
        });
      });

      await batch.commit();

      return NextResponse.json({ ok: true, saved: associations.length });
    }

    if (action === "finalizeImport") {
      const fileId = typeof body.fileId === "string" ? body.fileId : "";
      const updates = (body.updates ?? {}) as Partial<ConciliationImportFileRecord>;

      if (!fileId) {
        return NextResponse.json({ ok: false, error: "invalid_file" }, { status: 400 });
      }

      const documentRef = adminDb.collection(filesCollection).doc(fileId);
      const snapshot = await documentRef.get();

      if (!snapshot.exists) {
        return NextResponse.json({ ok: false, error: "file_not_found" }, { status: 404 });
      }

      const current = snapshot.data() as ConciliationImportFileRecord;

      await documentRef.set(
        {
          ...updates,
          id: fileId,
          updatedAt: nowIso(),
        },
        { merge: true }
      );

      // Atualiza contadores de categoria e template (não-bloqueante em erro).
      if (current.categoryId && updates.status && updates.status !== "error") {
        const categoryRef = adminDb.collection(categoriesCollection).doc(current.categoryId);
        const categorySnapshot = await categoryRef.get();

        if (categorySnapshot.exists) {
          const category = categorySnapshot.data() as ConciliationImportCategory;

          await categoryRef.set(
            { usageCount: (category.usageCount ?? 0) + 1, lastUsedAt: nowIso(), updatedAt: nowIso() },
            { merge: true }
          );
        }
      }

      const templateId = typeof body.templateId === "string" ? body.templateId : null;

      if (templateId) {
        const templateRef = adminDb.collection(templatesCollection).doc(templateId);
        const templateSnapshot = await templateRef.get();
        const fallback = defaultPlanilhaTemplates.find((template) => template.id === templateId);

        if (templateSnapshot.exists || fallback) {
          await templateRef.set(
            { ...(templateSnapshot.exists ? {} : fallback), lastUsedAt: nowIso() },
            { merge: true }
          );
        }
      }

      const updated = await documentRef.get();

      return NextResponse.json({ ok: true, record: updated.data() });
    }

    if (action === "deleteImport") {
      const fileId = typeof body.fileId === "string" ? body.fileId : "";

      if (!fileId) {
        return NextResponse.json({ ok: false, error: "invalid_file" }, { status: 400 });
      }

      const documentRef = adminDb.collection(filesCollection).doc(fileId);
      const snapshot = await documentRef.get();
      const record = snapshot.exists ? (snapshot.data() as ConciliationImportFileRecord) : null;
      const deletedAssociations = await deleteAssociationsByFileId(fileId);

      await documentRef.delete();

      if (record?.categoryId) {
        const categoryRef = adminDb.collection(categoriesCollection).doc(record.categoryId);
        const categorySnapshot = await categoryRef.get();

        if (categorySnapshot.exists) {
          const category = categorySnapshot.data() as ConciliationImportCategory;

          await categoryRef.set(
            { usageCount: Math.max(0, (category.usageCount ?? 0) - 1), updatedAt: nowIso() },
            { merge: true }
          );
        }
      }

      return NextResponse.json({ ok: true, deletedAssociations });
    }

    if (action === "checkConflicts") {
      const months = Array.isArray(body.months)
        ? (body.months as string[]).filter((month) => /^\d{4}-\d{2}$/.test(month)).slice(0, 24)
        : [];

      if (months.length === 0) {
        return NextResponse.json({ ok: true, associations: [] });
      }

      const queries = [];

      for (let index = 0; index < months.length; index += 30) {
        queries.push(
          adminDb
            .collection(associationsCollection)
            .where("saleMonth", "in", months.slice(index, index + 30))
            .get()
        );
      }

      const snapshots = await Promise.all(queries);
      const associations = snapshots.flatMap((snapshot) =>
        snapshot.docs.map((doc) => doc.data() as ConciliationSheetAssociation)
      );

      return NextResponse.json({ ok: true, associations });
    }

    if (action === "saveCategory") {
      const category = body.category as ConciliationImportCategory | undefined;

      if (!category?.name?.trim()) {
        return NextResponse.json({ ok: false, error: "invalid_category" }, { status: 400 });
      }

      const slug = (category.slug || category.name)
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      const id = category.id || `cat_${slug}_${Date.now().toString(36)}`;
      const stored: ConciliationImportCategory = {
        id,
        name: category.name.trim(),
        slug,
        color: category.color || "slate",
        icon: category.icon ?? null,
        sortOrder: Number.isFinite(category.sortOrder) ? category.sortOrder : 100,
        usageCount: category.usageCount ?? 0,
        isDefault: category.isDefault ?? false,
        createdAt: category.createdAt ?? nowIso(),
        updatedAt: nowIso(),
      };

      await adminDb.collection(categoriesCollection).doc(id).set(stored, { merge: true });

      return NextResponse.json({ ok: true, category: stored });
    }

    if (action === "deleteCategory") {
      const categoryId = typeof body.categoryId === "string" ? body.categoryId : "";

      if (!categoryId) {
        return NextResponse.json({ ok: false, error: "invalid_category" }, { status: 400 });
      }

      const snapshot = await adminDb.collection(categoriesCollection).doc(categoryId).get();
      const category = snapshot.exists ? (snapshot.data() as ConciliationImportCategory) : null;

      if (category && (category.usageCount ?? 0) > 0) {
        return NextResponse.json(
          { ok: false, error: "Categoria em uso por planilhas importadas." },
          { status: 409 }
        );
      }

      await adminDb.collection(categoriesCollection).doc(categoryId).delete();

      return NextResponse.json({ ok: true });
    }

    if (action === "saveTemplate") {
      const template = body.template as ConciliationImportTemplate | undefined;

      if (!template?.name?.trim() || !template?.marketplace || !template?.associationSettings?.keyColumn) {
        return NextResponse.json({ ok: false, error: "invalid_template" }, { status: 400 });
      }

      const id = template.id || `tpl_custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const stored: ConciliationImportTemplate = {
        ...template,
        id,
        isDefault: template.isDefault ?? false,
        lastUsedAt: template.lastUsedAt ?? null,
      };

      await adminDb.collection(templatesCollection).doc(id).set(stored, { merge: true });

      return NextResponse.json({ ok: true, template: stored });
    }

    if (action === "deleteTemplate") {
      const templateId = typeof body.templateId === "string" ? body.templateId : "";

      if (!templateId) {
        return NextResponse.json({ ok: false, error: "invalid_template" }, { status: 400 });
      }

      if (defaultPlanilhaTemplates.some((template) => template.id === templateId)) {
        return NextResponse.json(
          { ok: false, error: "Templates padrão não podem ser excluídos." },
          { status: 409 }
        );
      }

      await adminDb.collection(templatesCollection).doc(templateId).delete();

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
  } catch (error) {
    console.error("Erro na API de planilhas:", error);
    return NextResponse.json(
      { ok: false, error: "Não foi possível processar a operação." },
      { status: 500 }
    );
  }
}
