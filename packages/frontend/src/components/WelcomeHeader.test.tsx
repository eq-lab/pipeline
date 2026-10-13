import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("./HomeStatsStrip", () => ({ HomeStatsStrip: () => null }));

import { WelcomeHeader } from "./WelcomeHeader";

describe("WelcomeHeader", () => {
  it("renders 'Welcome back' exactly once when isReturning", () => {
    render(<WelcomeHeader isReturning />);
    expect(screen.getAllByText("Welcome back")).toHaveLength(1);
    expect(screen.getByTestId("home-welcome-heading")).toHaveTextContent(
      /^Welcome back$/,
    );
  });

  it("renders 'Welcome' by default and when isReturning is false", () => {
    const { rerender } = render(<WelcomeHeader />);
    expect(screen.getByTestId("home-welcome-heading")).toHaveTextContent(
      /^Welcome$/,
    );
    rerender(<WelcomeHeader isReturning={false} />);
    expect(screen.getByTestId("home-welcome-heading")).toHaveTextContent(
      /^Welcome$/,
    );
    expect(screen.queryByText("Welcome back")).not.toBeInTheDocument();
  });

  it("renders one string node with no responsive descendants", () => {
    render(<WelcomeHeader isReturning />);
    const heading = screen.getByTestId("home-welcome-heading");
    expect(heading.children).toHaveLength(0);
    expect(heading.querySelector(".hidden, .md\\:hidden")).toBeNull();
  });
});
