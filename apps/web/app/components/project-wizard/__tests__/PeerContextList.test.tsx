import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PeerContextList } from "../PeerContextList";

// Mock the necessary types and components
const mockOnAddContext = jest.fn();
const mockOnUpdateContext = jest.fn();

const mockExternalContexts = [
  { id: "peer-1", name: "Auth Service" },
  { id: "peer-2", name: "Payment Gateway" },
];

describe("PeerContextList", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders without crashing", () => {
    render(
      <PeerContextList
        contexts={mockExternalContexts}
        onAddContext={mockOnAddContext}
        onUpdateContext={mockOnUpdateContext}
      />
    );
    expect(screen.getByText(/Peer Bounded Contexts/)).toBeInTheDocument();
  });

  it("renders multiple peer contexts", () => {
    render(
      <PeerContextList
        contexts={mockExternalContexts}
        onAddContext={mockOnAddContext}
        onUpdateContext={mockOnUpdateContext}
      />
    );
    expect(screen.getByText("Auth Service")).toBeInTheDocument();
    expect(screen.getByText("Payment Gateway")).toBeInTheDocument();
  });

  it("renders add peer button", () => {
    render(
      <PeerContextList
        contexts={mockExternalContexts}
        onAddContext={mockOnAddContext}
        onUpdateContext={mockOnUpdateContext}
      />
    );
    expect(screen.getByText("+ Add Peer")).toBeInTheDocument();
  });

  it("calls onAddContext when add button is clicked", () => {
    render(
      <PeerContextList
        contexts={mockExternalContexts}
        onAddContext={mockOnAddContext}
        onUpdateContext={mockOnUpdateContext}
      />
    );
    const addButton = screen.getByText("+ Add Peer");
    userEvent.click(addButton);
    expect(mockOnAddContext).toHaveBeenCalledTimes(1);
  });

  it("renders empty state when no peers", () => {
    render(
      <PeerContextList
        contexts={[]}
        onAddContext={mockOnAddContext}
        onUpdateContext={mockOnUpdateContext}
      />
    );
    expect(screen.getByText("No peer contexts defined")).toBeInTheDocument();
  });

  it("renders add peer button in empty state", () => {
    render(
      <PeerContextList
        contexts={[]}
        onAddContext={mockOnAddContext}
        onUpdateContext={mockOnUpdateContext}
      />
    );
    expect(screen.getByText("Add First Peer Context")).toBeInTheDocument();
  });

  it("calls onAddContext when add button is clicked in empty state", () => {
    render(
      <PeerContextList
        contexts={[]}
        onAddContext={mockOnAddContext}
        onUpdateContext={mockOnUpdateContext}
      />
    );
    const addButton = screen.getByText("Add First Peer Context");
    userEvent.click(addButton);
    expect(mockOnAddContext).toHaveBeenCalledTimes(1);
  });
});
