# Welcome Modal + Local LLM Integration

This document outlines the design and implementation plan for integrating model selection with the welcome modal in the HexaGen Monaco project.

## Problem Statement

The welcome modal allows users to describe their project and generate a manifest using AI. However, it currently doesn't account for the need to download and initialize a local LLM before generating content, leading to a poor UX where users might unexpectedly need to download large model files without warning.

## Design Goals

1. Provide a transparent and intuitive UX for model selection and download
2. Maintain consistency with the existing governance panel's model handling
3. Allow graceful fallbacks to cloud providers when appropriate
4. Support both first-time and returning users with appropriate flows
5. Persist user preferences across sessions
6. Handle edge cases like interrupted downloads, hardware incompatibility, etc.

## State Machine Design

We're implementing a clear state machine to handle the welcome modal flow:

```
stateDiagram-v2
    [*] --> idle
    
    idle --> model_selection: Generate clicked
    
    model_selection --> model_downloading: Local model selected
    model_selection --> key_validation: Cloud provider selected  
    model_selection --> idle: Cancel clicked
    
    model_downloading --> generating: Download complete
    model_downloading --> interrupted: User cancels
    model_downloading --> error: Download fails
    
    interrupted --> model_selection: Try again
    interrupted --> idle: Skip AI
    
    key_validation --> generating: Key valid
    key_validation --> error: Key invalid
    key_validation --> model_selection: Back clicked
    
    generating --> preview: Generation succeeds
    generating --> error: Generation fails
    
    preview --> idle: Reject manifest
    preview --> wizard_hydration: Accept manifest
    
    error --> idle: Skip AI
    error --> model_selection: Try different option
```

## Component Architecture

```
└── ModelSelectionFlow/
    ├── useWelcomeFlowState.ts       // Core state machine logic
    ├── ModelSelectionContainer.tsx  // Orchestrates the flow states
    ├── ModelCategorySelector.tsx    // High-level local vs cloud choice
    ├── LocalModelOptions.tsx        // Shows hardware-appropriate model choices  
    ├── CloudProviderForm.tsx        // API key entry with validation
    ├── DownloadProgressIndicator.tsx // Specific to model acquisition
    ├── InterruptedView.tsx          // Shown when download is canceled
    └── UnsupportedHardwareMessage.tsx // WebGPU detection failure messaging
```

## Implementation Approach

### 1. WebGPU Detection

- Run WebGPU detection on initial mount of welcome screen
- Uses existing detection logic from the LLM driver 
- Disable local model option if not supported
- Show clear hardware requirements messaging

### 2. Preference Persistence

- Store model selection preferences in localStorage
- Use the same keys as the governance panel for consistency
- "Remember choice" option defaulted to off (opt-in)
- Returning users bypass selection if they previously opted in

### 3. Error and Recovery Handling

- Graceful handling of download interruptions
- Allow retrying from interruption state
- Smoke test model integrity after download
- Provide browser-specific guidance where needed

### 4. Server-Side Support

- Support both local and cloud model inference
- Create new route for local model inference
- Provide fallback paths in case of failures

## UX Considerations

### Remember Choice Placement

The "Remember my choice" checkbox appears directly after model selection (not after generation), when the choice is still top-of-mind for the user.

### Preview → Reject Flow

When a user rejects a generated manifest, we preserve the content temporarily in state and offer a "regenerate" option. This prevents loss of generated content with a single click.

### WebGPU Guidance

For browser-specific WebGPU guidance, we link to canonical documentation sources rather than providing static instructions that may go out of date.

## Technical Dependencies

1. Existing LocalLLM context and hooks
2. Manifest generation API endpoint
3. UI components from @hexagen/ui
4. WebGPU detection mechanism

## Implementation Phases

1. State machine and component structure implementation
2. LLM provider adapter for both cloud and local models
3. API route updates for local model support
4. UX components including progress indicators
5. Integration with welcome screen component
6. Edge case handling and optimizations

## Performance Considerations

- Download progress rendering optimization
- Caching of models in IndexedDB
- Smoke tests for model integrity before use