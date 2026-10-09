import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddressChip, shortAddress } from "./AddressChip";

const ADDRESS = "GCGQVOJ7WKIN3BP5C4ILNGHSQOVNJVHI2YMEULQKXCQXS4";
const writeText = vi.fn();

function withClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  withClipboard({ writeText });
});

afterEach(() => {
  withClipboard(undefined);
});

describe("shortAddress", () => {
  it("keeps the last five characters behind an ellipsis", () => {
    expect(shortAddress(ADDRESS)).toBe("…CQXS4");
  });

  it("renders a value of five characters or fewer verbatim", () => {
    expect(shortAddress("GABCD")).toBe("GABCD");
    expect(shortAddress("")).toBe("");
  });
});

describe("AddressChip", () => {
  it("renders the truncated value with the full value as its title", () => {
    render(<AddressChip value={ADDRESS} testId="chip" />);
    const button = screen.getByTestId("chip");
    expect(button).toHaveTextContent("…CQXS4");
    expect(button).toHaveAttribute("title", ADDRESS);
    expect(button).toHaveAttribute("data-revealed", "false");
  });

  it("reveals the full value and copies it on click", async () => {
    render(<AddressChip value={ADDRESS} testId="chip" />);
    fireEvent.click(screen.getByTestId("chip"));
    expect(screen.getByTestId("chip")).toHaveTextContent(ADDRESS);
    expect(screen.getByTestId("chip")).toHaveAttribute("data-revealed", "true");
    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("collapses back to the truncated value on a second click", async () => {
    render(<AddressChip value={ADDRESS} testId="chip" />);
    fireEvent.click(screen.getByTestId("chip"));
    await screen.findByText("Copied");
    fireEvent.click(screen.getByTestId("chip"));
    expect(screen.getByTestId("chip")).toHaveTextContent("…CQXS4");
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });

  it("still reveals the value when no clipboard is available", async () => {
    withClipboard(undefined);
    render(<AddressChip value={ADDRESS} testId="chip" />);
    fireEvent.click(screen.getByTestId("chip"));
    expect(screen.getByTestId("chip")).toHaveTextContent(ADDRESS);
    await waitFor(() =>
      expect(screen.queryByText("Copied")).not.toBeInTheDocument(),
    );
  });

  it("stays silent when the clipboard write is rejected", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<AddressChip value={ADDRESS} testId="chip" />);
    fireEvent.click(screen.getByTestId("chip"));
    expect(screen.getByTestId("chip")).toHaveTextContent(ADDRESS);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });
});
