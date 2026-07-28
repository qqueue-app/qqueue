import type { Request, Response } from "express";
import {
  contactActivityQuerySchema,
  contactBulkDeleteSchema,
  contactSchema,
  csvImportPreviewSchema,
  csvImportSchema,
  segmentFilterSchema
} from "@qqueue/shared";
import { HttpError } from "../../lib/http-error.js";
import { contactService } from "./service.js";

/** CSV arrives either as an uploaded file (multipart) or a `csv` body field. */
function readCsv(req: Request): string {
  const csv = req.file
    ? req.file.buffer.toString("utf8")
    : typeof req.body?.csv === "string"
      ? req.body.csv
      : undefined;

  if (!csv) {
    throw new HttpError(
      400,
      "A CSV file or csv field is required",
      "validation_error"
    );
  }
  return csv;
}

/**
 * Duplicate resolutions travel as a JSON string on multipart requests and as a
 * plain object on JSON ones. Malformed JSON is a client error rather than a
 * silently ignored field — dropping it would apply the default resolution to
 * every duplicate, overwriting contacts the user had chosen to keep.
 */
function parseOverrides(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new HttpError(
      400,
      "overrides must be valid JSON",
      "validation_error"
    );
  }
}

export const contactController = {
  async list(req: Request, res: Response) {
    // organizationId is verified and pinned by requireOrgMembership.
    const contacts = await contactService.list(req.organizationId!);
    res.json({ data: contacts });
  },

  async get(req: Request, res: Response) {
    const contact = await contactService.get(
      String(req.params.id),
      req.userId!
    );

    if (!contact) {
      res.status(404).json({ error: { message: "Contact not found" } });
      return;
    }

    res.json({ data: contact });
  },

  async create(req: Request, res: Response) {
    const input = contactSchema.parse(req.body);
    const contact = await contactService.create(input);
    res.status(201).json({ data: contact });
  },

  async update(req: Request, res: Response) {
    const input = contactSchema.parse(req.body);
    const contact = await contactService.update(
      String(req.params.id),
      req.userId!,
      input
    );
    res.json({ data: contact });
  },

  async delete(req: Request, res: Response) {
    await contactService.delete(String(req.params.id), req.userId!);
    res.status(204).send();
  },

  async bulkDelete(req: Request, res: Response) {
    const { contactIds } = contactBulkDeleteSchema.parse(req.body);
    const result = await contactService.bulkDelete(
      // organizationId is verified and pinned by requireOrgMembership.
      req.organizationId!,
      req.userId!,
      contactIds
    );
    res.json({ data: result });
  },

  async previewSegment(req: Request, res: Response) {
    const input = segmentFilterSchema.parse(req.body);
    const result = await contactService.previewSegment(input);
    res.json({ data: result });
  },

  async activity(req: Request, res: Response) {
    const query = contactActivityQuerySchema.parse(req.query);
    const result = await contactService.activity(
      String(req.params.id),
      req.userId!,
      query
    );
    res.json({ data: result });
  },

  async importPreview(req: Request, res: Response) {
    const csv = readCsv(req);
    const { organizationId, contactListId, contactListName } =
      csvImportPreviewSchema.parse(req.body);
    const preview = await contactService.previewImport({
      organizationId,
      csv,
      contactListId,
      contactListName
    });
    res.status(200).json({ data: preview });
  },

  async import(req: Request, res: Response) {
    const csv = readCsv(req);
    const {
      organizationId,
      contactListId,
      contactListName,
      defaultResolution,
      overrides
    } = csvImportSchema.parse({
      ...req.body,
      // Multipart carries every field as text, so the review screen's decisions
      // arrive as a JSON string alongside the file.
      overrides: parseOverrides(req.body?.overrides)
    });

    const summary = await contactService.importContacts({
      organizationId,
      csv,
      contactListId,
      contactListName,
      defaultResolution,
      overrides
    });
    res.status(200).json({ data: summary });
  },

  async export(req: Request, res: Response) {
    const contactListId =
      typeof req.query.contactListId === "string"
        ? req.query.contactListId
        : undefined;

    const csv = await contactService.exportContacts(
      // organizationId is verified and pinned by requireOrgMembership.
      req.organizationId!,
      contactListId
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="contacts.csv"');
    res.send(csv);
  }
};
