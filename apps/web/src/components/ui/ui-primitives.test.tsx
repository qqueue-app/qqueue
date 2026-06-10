import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Alert, AlertDescription, AlertTitle } from "./alert.js";
import { Badge } from "./badge.js";
import { Button } from "./button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "./card.js";
import { Checkbox } from "./checkbox.js";
import { Input } from "./input.js";
import { Label } from "./label.js";
import { Separator } from "./separator.js";
import { Skeleton } from "./skeleton.js";
import { Spinner } from "./spinner.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "./table.js";
import { Textarea } from "./textarea.js";

describe("Button", () => {
  it("renders with default variant and handles clicks", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    await user.click(screen.getByRole("button", { name: "Click" }));
    expect(onClick).toHaveBeenCalled();
  });

  it("renders as a child element when asChild is set", () => {
    render(
      <Button asChild variant="outline" size="sm">
        <a href="/x">Link</a>
      </Button>
    );
    expect(screen.getByRole("link", { name: "Link" })).toHaveAttribute(
      "href",
      "/x"
    );
  });
});

describe("Badge", () => {
  it("renders each variant", () => {
    const { rerender } = render(<Badge>Default</Badge>);
    expect(screen.getByText("Default")).toBeInTheDocument();
    for (const variant of [
      "secondary",
      "destructive",
      "success",
      "warning",
      "outline"
    ] as const) {
      rerender(<Badge variant={variant}>{variant}</Badge>);
      expect(screen.getByText(variant)).toBeInTheDocument();
    }
  });
});

describe("Alert", () => {
  it("renders title and description", () => {
    render(
      <Alert variant="info">
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>Some detail</AlertDescription>
      </Alert>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Heads up")).toBeInTheDocument();
    expect(screen.getByText("Some detail")).toBeInTheDocument();
  });
});

describe("Card", () => {
  it("renders the full composition", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Desc</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>
    );
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Desc")).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
    expect(screen.getByText("Footer")).toBeInTheDocument();
  });
});

describe("Checkbox", () => {
  it("toggles on click", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Checkbox
        checked={false}
        onCheckedChange={onCheckedChange}
        aria-label="agree"
      />
    );
    const box = screen.getByRole("checkbox", { name: "agree" });
    expect(box).toHaveAttribute("aria-checked", "false");
    await user.click(box);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("shows the check icon when checked", () => {
    render(
      <Checkbox checked onCheckedChange={() => {}} aria-label="checked" />
    );
    expect(screen.getByRole("checkbox", { name: "checked" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });
});

describe("form primitives", () => {
  it("renders Input, Textarea and Label", () => {
    render(
      <div>
        <Label htmlFor="f">Field</Label>
        <Input id="f" placeholder="type" />
        <Textarea placeholder="area" />
      </div>
    );
    expect(screen.getByText("Field")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("type")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("area")).toBeInTheDocument();
  });
});

describe("misc primitives", () => {
  it("renders Separator, Skeleton and Spinner", () => {
    const { container } = render(
      <div>
        <Separator orientation="vertical" />
        <Skeleton className="h-4" />
        <Spinner />
      </div>
    );
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });
});

describe("Table", () => {
  it("renders a complete table", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Col</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Value</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    expect(screen.getByText("Col")).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
  });
});
