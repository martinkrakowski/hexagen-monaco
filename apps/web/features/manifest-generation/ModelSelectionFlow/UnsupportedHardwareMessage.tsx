"use client";

import { useEffect, useState } from "react";
import { Button, Icon } from "@hexagen/ui";
import { useWebGPUDetection } from "./useWebGPUDetection";

interface UnsupportedHardwareMessageProps {
  onCancel: () => void;
}

export function UnsupportedHardwareMessage({ onCancel }: UnsupportedHardwareMessageProps) {
  const gpuDetection = useWebGPUDetection();
  const [browserName, setBrowserName] = useState<string>("your browser");

  useEffect(() => {
    // Detect browser for specific messaging
    const userAgent = navigator.userAgent;
    if (userAgent.indexOf("Chrome") > -1) {
      setBrowserName("Chrome");
    } else if (userAgent.indexOf("Safari") > -1) {
      setBrowserName("Safari");
    } else if (userAgent.indexOf("Firefox") > -1) {
      setBrowserName("Firefox");
    } else if (userAgent.indexOf("Edge") > -1) {
      setBrowserName("Edge");
    }
  }, []);

  // Determine the specific issue
  const isBrowserSupported = gpuDetection.isBrowserSupported;
  const isHardwareAdequate = gpuDetection.isHardwareAdequate;

  // Generate browser-specific guidance
  const getBrowserGuidance = () => {
    if (!isBrowserSupported) {
      switch (browserName.toLowerCase()) {
        case "chrome":
          return (
            <>
              <p>Chrome version 113 or newer is required for WebGPU support.</p>
              <p className="mt-2">
                <a 
                  href="chrome://flags/#enable-unsafe-webgpu" 
                  className="text-primary underline"
                  onClick={(e) => {
                    e.preventDefault();
                    alert('Please type "chrome://flags/#enable-unsafe-webgpu" in your address bar and enable WebGPU.');
                  }}
                >
                  Enable WebGPU flag
                </a> in your browser settings.
              </p>
            </>
          );
        case "edge":
          return "Edge version 113 or newer is required for WebGPU support. You may need to enable the WebGPU flag in edge://flags.";
        case "firefox":
          return "Firefox currently has limited WebGPU support. Try enabling 'dom.webgpu.enabled' in about:config.";
        case "safari":
          return "Safari 16.4 or newer is required for WebGPU support. Please update your browser.";
        default:
          return "Your browser doesn't support WebGPU yet. Please try Chrome 113+.";
      }
    } else if (!isHardwareAdequate) {
      return "Your hardware doesn't meet the minimum requirements for running AI models locally.";
    }
    return "WebGPU is required but not available on your system.";
  };

  return (
    <div className="flex flex-col items-center text-center space-y-6">
      <div className="rounded-full bg-destructive/20 p-3 w-12 h-12 flex items-center justify-center">
        <Icon name="warning" className="h-6 w-6 text-destructive" />
      </div>
      
      <div className="space-y-2">
        <h3 className="text-lg font-medium">WebGPU Support Required</h3>
        <p className="text-sm text-muted-foreground">
          {!isBrowserSupported 
            ? "Your browser doesn't fully support WebGPU, which is needed for local AI models." 
            : !isHardwareAdequate 
              ? "Your device doesn't meet the requirements for running local AI models." 
              : "WebGPU is required but not working on your device."}
        </p>
      </div>
      
      <div className="w-full space-y-4">
        <div className="bg-muted/50 rounded-lg p-4 text-left">
          <h4 className="font-medium mb-2 flex items-center">
            <Icon name="info" className="mr-2 h-4 w-4 text-info" /> 
            Browser Information
          </h4>
          <div className="text-sm text-muted-foreground space-y-2">
            {getBrowserGuidance()}
          </div>
        </div>
        
        <div className="bg-muted/50 rounded-lg p-4 text-left">
          <h4 className="font-medium mb-2">Hardware Requirements</h4>
          <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
            <li>A modern GPU with at least 2GB VRAM</li>
            <li>Updated graphics drivers</li>
            <li>WebGPU-capable browser (Chrome 113+, Edge 113+, or Safari 16.4+)</li>
          </ul>
        </div>
      </div>
      
      <div className="w-full grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={onCancel} className="w-full">
          Use Cloud Option Instead
        </Button>
        <a 
          href="https://developer.chrome.com/docs/web-platform/webgpu/" 
          target="_blank" 
          rel="noopener noreferrer"
          className="w-full"
        >
          <Button variant="secondary" className="w-full">
            <Icon name="link" className="mr-2 h-4 w-4" />
            Learn About WebGPU
          </Button>
        </a>
      </div>
    </div>
  );
}