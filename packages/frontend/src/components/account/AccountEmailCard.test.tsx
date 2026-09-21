import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountEmailCard } from "./AccountEmailCard";

describe("AccountEmailCard", () => {
  it("renders the address when supplied", () => {
    render(<AccountEmailCard email="hello@eqlab.io" />);
    expect(screen.getByText("hello@eqlab.io")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
  });

  it("renders — when no email is supplied", () => {
    render(<AccountEmailCard />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("has no edit control", () => {
    render(<AccountEmailCard email="hello@eqlab.io" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
