"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The Tier-B availability probe (BF-5.3), extracted so that BOTH screens that
 * have to tell the truth about server-side cloning read the same answer from
 * the same mechanism.
 *
 * It was born inside `useGithubScan`, which is the right place for the screen
 * that runs a scan. It is the wrong place for the TIER PICKER, which must state
 * whether the tier is reachable without pulling in a streaming transport it
 * will never use — and duplicating the probe there would give the product two
 * mechanisms that can disagree. So the probe moved down here and
 * `useGithubScan` consumes it; there is still exactly one.
 *
 * ## The screen always exists; the endpoint usually does not
 *
 * `/projects/new/import/github` is mounted unconditionally, but
 * `BROWNFIELD_GITHUB_SCAN` is OFF unless a deployment sets it, and the route
 * then answers 404 to both GET and POST. So "available" and "not available yet"
 * are both wrong as fixed copy: the first lies on a default deployment, the
 * second lies on a configured one.
 */

/**
 * What the deployment says about this endpoint.
 *
 * `not-enabled` is the DEFAULT state of the world, not an edge case. Learning
 * it before the user commits to a tier is the difference between an honest
 * screen and a form that throws an error on submit.
 */
export type GithubScanAvailability =
  | "checking"
  | "available"
  | "not-enabled"
  /** The probe itself failed. Not evidence of anything — let the POST speak. */
  | "unknown";

/** The one route both the probe and the scan transport talk to. */
export const GITHUB_SCAN_ENDPOINT = "/api/projects/scan/github";

export interface UseGithubScanAvailabilityReturn {
  readonly availability: GithubScanAvailability;
  /**
   * Record a 404 observed by a caller's own request. The switch can be turned
   * off between the probe and a later POST, and the fact the POST learned is
   * newer than the fact the probe learned.
   *
   * Deliberately one-way: there is no `markAvailable`. A caller cannot talk
   * this state UP, only down, so nothing can promote a hopeful guess into a
   * promise the endpoint has not made.
   */
  readonly markNotEnabled: () => void;
}

export function useGithubScanAvailability(): UseGithubScanAvailabilityReturn {
  const [availability, setAvailability] =
    useState<GithubScanAvailability>("checking");

  /**
   * Latches once the POST has proved the endpoint is off, so the in-flight GET
   * cannot promote it back.
   *
   * Raised in review on #619. `markNotEnabled` was one-way in its PUBLIC API --
   * there is no `markAvailable` -- but not in effect: the mount-time probe's
   * `cancelled` flag guards UNMOUNT, not a state transition, so a GET resolving
   * 405 AFTER a POST returned 404 would overwrite `not-enabled` with
   * `available`. The screen would then offer a tier the server had just
   * refused, which is the exact false promise this hook exists to prevent.
   *
   * Ordering makes it unlikely -- the GET starts on mount and the POST needs a
   * user -- but a slow proxy and a fast click is all it takes, and "unlikely"
   * is not the contract the docstring states.
   */
  const provenOff = useRef(false);

  /**
   * `GET` mirrors `POST`'s kill switch on purpose (see the route's own
   * comment): 404 when the feature is off, 405 with `Allow: POST` when it is
   * on. It is not rate-limited — `guardMutation` runs on POST only — so this
   * costs nothing but one cheap round trip.
   *
   * Anything other than those two answers leaves availability `unknown` rather
   * than guessing. A proxy that rewrites errors must not be able to hide a
   * working feature behind a "not available" screen.
   */
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(GITHUB_SCAN_ENDPOINT, {
          method: "GET",
          signal: controller.signal,
        });
        if (cancelled || provenOff.current) return;
        if (response.status === 404) {
          setAvailability("not-enabled");
        } else if (response.status === 405 || response.ok) {
          setAvailability("available");
        } else {
          setAvailability("unknown");
        }
      } catch {
        if (!cancelled && !provenOff.current) setAvailability("unknown");
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const markNotEnabled = useCallback(() => {
    provenOff.current = true;
    setAvailability("not-enabled");
  }, []);

  return { availability, markNotEnabled };
}
