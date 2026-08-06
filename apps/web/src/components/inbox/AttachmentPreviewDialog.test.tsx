import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  AttachmentPreviewDialog,
  attachmentPreviewKind
} from "./AttachmentPreviewDialog.js";

describe("attachmentPreviewKind", () => {
  it("renders raster images, PDFs and plain text in place", () => {
    expect(attachmentPreviewKind("image/png")).toBe("image");
    expect(attachmentPreviewKind("image/jpeg; name=photo.jpg")).toBe("image");
    expect(attachmentPreviewKind("APPLICATION/PDF")).toBe("pdf");
    expect(attachmentPreviewKind("text/plain; charset=utf-8")).toBe("text");
  });

  it("refuses anything the browser would parse as a document", () => {
    // A blob: URL inherits our origin, so rendering sender-supplied markup
    // here would be stored XSS — these have to stay downloads.
    expect(attachmentPreviewKind("image/svg+xml")).toBeNull();
    expect(attachmentPreviewKind("text/html")).toBeNull();
    expect(attachmentPreviewKind("application/xhtml+xml")).toBeNull();
    expect(attachmentPreviewKind("application/octet-stream")).toBeNull();
  });
});

describe("AttachmentPreviewDialog", () => {
  it("renders nothing when there is nothing to preview", () => {
    const { container } = render(
      <AttachmentPreviewDialog preview={null} onClose={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows text without handing the bytes to an HTML parser", async () => {
    render(
      <AttachmentPreviewDialog
        preview={{
          attachment: {
            id: "att_1",
            filename: "notes.txt",
            contentType: "text/plain",
            size: 20,
            isInline: false
          },
          blob: new Blob(["<b>not markup</b>"], { type: "text/plain" })
        }}
        onClose={() => {}}
      />
    );

    expect(await screen.findByText("<b>not markup</b>")).toBeInTheDocument();
  });
});
