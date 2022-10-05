/*
 * Copyright 2012-2022 Online-Go.com
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

export function escapeSGFText(txt: string): string {
    // escape slashes first
    // 'blah\blah' -> 'blah\\blah'
    txt = txt.replace(/\\/g, "\\\\");

    // escape closing square bracket ]
    // 'hideki[9dan]' -> 'hideki[9dan\]'
    txt = txt.replace(/]/g, "\\]");

    // no need to escape opening bracket, SGF grammar handles that
    // 'C[[[[[[blabla]'
    //   ^ after it finds the first [, it is only looking for the closing bracket
    // parsing SGF properties, so the remaining [ are safely treated as text
    //txt = txt.replace(/[/g, "\\[");
    return txt;
}
