import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BoundedContextList } from "../BoundedContextList";

// Mock the necessary types and components
const mockOnAddContext = jest.fn();
const mockOnUpdateContext = jest.fn();

const mockBoundedContexts = [
  { id: "context-1", name: "Core" },
  { id: "context-2", name: "User Management" },
];

describe("BoundedContextList", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders without crashing", () => {
    render(
      <BoundedContextList
        contexts={mockBoundedContexts}
        onAddContext={mockOnAddContext}
        onUpdateContext={mockOnUpdateContext}
      />,
    );
    expect(screen.getByText(/Bounded Contexts/)).toBeInTheDocument();
  });

  it("renders multiple bounded contexts", () => {
    render(
      <BoundedContextList
        contexts={mockBoundedContexts}
        onAddContext={mockOnAddContext}
        onUpdateContext={mockOnUpdateContext}
      />,
    );
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("User Management")).toBeInTheDocument();
  });

  it("renders add context button", () => {
    render(
      <BoundedContextList
        contexts={mockBoundedContexts}
        onAddContext={mockOnAddContext}
        onUpdateContext={mockOnUpdateContext}
      />,
    );
    expect(screen.getByText("+ Add Context")).toBeInTheDocument();
  });

  it("calls onAddContext when add button is clicked", () => {
    render(
      <BoundedContextList
        contexts={mockBoundedContexts}
        onAddContext={mockOnAddContext}
        onUpdateContext={mockOnUpdateContext}
      />,
    );
    const addButton = screen.getByText("+ Add Context");
    userEvent.click(addButton);
    expect(mockOnAddContext).toHaveBeenCalledTimes(1);
  });

  it("renders empty state when no contexts", () => {
    render(
      <BoundedContextList
        contexts={[]}
        onAddContext={mockOnAddContext}
        onUpdateContext={mockOnUpdateContext}
      />,
    );
    expect(screen.getByText("No bounded contexts defined")).toBeInTheDocument();
  });

  it("renders add context button in empty state", () => {
    render(
      <BoundedContextList
        contexts={[]}
        onAddContext={mockOnAddContext}
        onUpdateContext={mockOnUpdateContext}
      />,
    );
    expect(screen.getByText("Add Your First Context")).toBeInTheDocument();
  });

  it("calls onAddContext when add button is clicked in empty state", () => {
    render(
      <BoundedContextList
        contexts={[]}
        onAddContext={mockOnAddContext}
        onUpdateContext={mockOnUpdateContext}
      />,
    );
    const addButton = screen.getByText("Add Your First Context");
    userEvent.click(addButton);
    expect(mockOnAddContext).toHaveBeenCalledTimes(1);
  });
});
