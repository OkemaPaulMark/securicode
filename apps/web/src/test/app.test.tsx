import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../App";
import { PageProvider, SessionProvider, ToastProvider } from "../lib/session";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider><SessionProvider><PageProvider><AppRoutes /></PageProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
}

describe("web app", () => {
  it("sends signed-out visitors to sign in", async () => {
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByLabelText("E-mail")).toBeTruthy();
  });

  it("explains the password rule on registration", async () => {
    renderAt("/register");
    expect(await screen.findByText(/At least 10 characters/)).toBeTruthy();
  });

  it("opens the sample workspace and shows projects with text severity labels", async () => {
    renderAt("/signin");
    fireEvent.click(await screen.findByRole("button", { name: "Explore with sample data" }));
    expect(await screen.findByText("hostel-booking", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/Sample data/)).toBeTruthy();
    expect(screen.getAllByText("Critical", { exact: false }).length).toBeGreaterThan(0);
  });
});
