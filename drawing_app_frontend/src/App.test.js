import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders drawing studio header", () => {
  render(<App />);
  expect(screen.getByText(/Responsive Drawing Studio/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /tools/i })).toBeInTheDocument();
});
