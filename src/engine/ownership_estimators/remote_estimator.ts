/*
 * Copyright (C) Online-Go.com
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { ScoreEstimateRequest, ScoreEstimateResponse } from "../ScoreEstimator";

export let remote_estimate_ownership:
    | ((req: ScoreEstimateRequest) => Promise<ScoreEstimateResponse>)
    | undefined;

/* Sets the callback to use to preform an ownership estimate */
export function init_remote_ownership_estimator(
    scorer: (req: ScoreEstimateRequest) => Promise<ScoreEstimateResponse>,
): void {
    remote_estimate_ownership = scorer;
}
