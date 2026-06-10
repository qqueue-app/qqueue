import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "./dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "./dropdown-menu.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./select.js";

describe("Dialog", () => {
  it("opens via the trigger and renders content", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>My dialog</DialogTitle>
            <DialogDescription>Details here</DialogDescription>
          </DialogHeader>
          <DialogFooter>Footer</DialogFooter>
        </DialogContent>
      </Dialog>
    );
    expect(screen.queryByText("My dialog")).not.toBeInTheDocument();
    await user.click(screen.getByText("Open"));
    expect(await screen.findByText("My dialog")).toBeInTheDocument();
    expect(screen.getByText("Details here")).toBeInTheDocument();
    expect(screen.getByText("Footer")).toBeInTheDocument();
  });
});

describe("DropdownMenu", () => {
  it("opens and fires onSelect", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Section</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onSelect}>Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    await user.click(screen.getByText("Menu"));
    const item = await screen.findByText("Item");
    expect(screen.getByText("Section")).toBeInTheDocument();
    await user.click(item);
    expect(onSelect).toHaveBeenCalled();
  });
});

describe("Select", () => {
  it("opens and selects a value", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Select onValueChange={onValueChange}>
        <SelectTrigger aria-label="fruit">
          <SelectValue placeholder="Pick one" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana">Banana</SelectItem>
        </SelectContent>
      </Select>
    );
    expect(screen.getByText("Pick one")).toBeInTheDocument();
    await user.click(screen.getByLabelText("fruit"));
    const option = await screen.findByText("Banana");
    await user.click(option);
    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith("banana"));
  });
});
