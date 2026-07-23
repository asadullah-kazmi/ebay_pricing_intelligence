import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";

export class CatalogSavedViewError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "CatalogSavedViewError";
  }
}

export interface CatalogSavedViewInput {
  name: string;
  filters: Prisma.InputJsonObject;
  isDefault?: boolean;
}

const select = {
  id: true,
  name: true,
  filters: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CatalogSavedViewSelect;

export function listCatalogSavedViews(organizationId: string, userId: string) {
  return prisma.catalogSavedView.findMany({
    where: { organizationId, userId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select,
  });
}

export async function saveCatalogView(
  organizationId: string,
  userId: string,
  input: CatalogSavedViewInput,
  viewId?: string,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      if (viewId) {
        const existing = await tx.catalogSavedView.findFirst({ where: { id: viewId, organizationId, userId }, select: { id: true } });
        if (!existing) throw new CatalogSavedViewError("Saved catalog view not found", 404);
      }
      if (input.isDefault) {
        await tx.catalogSavedView.updateMany({ where: { organizationId, userId, isDefault: true }, data: { isDefault: false } });
      }
      return viewId
        ? tx.catalogSavedView.update({
          where: { id: viewId },
          data: { name: input.name.trim(), filters: input.filters, ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}) },
          select,
        })
        : tx.catalogSavedView.create({
          data: { organizationId, userId, name: input.name.trim(), filters: input.filters, isDefault: input.isDefault ?? false },
          select,
        });
    });
  } catch (error) {
    if (error instanceof CatalogSavedViewError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new CatalogSavedViewError("You already have a saved view with this name", 409);
    }
    throw error;
  }
}

export async function deleteCatalogSavedView(organizationId: string, userId: string, viewId: string) {
  const result = await prisma.catalogSavedView.deleteMany({ where: { id: viewId, organizationId, userId } });
  if (!result.count) throw new CatalogSavedViewError("Saved catalog view not found", 404);
  return { deleted: true };
}
