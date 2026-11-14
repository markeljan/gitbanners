/**
 * The README behind "Try an example": the kind of profile README the doctor
 * exists for, with a dead card of every common kind, a card that still works
 * and one with no equivalent. The username is the docs' example login.
 */
import { site } from "@/lib/site";

const user = site.exampleLogin;

export const EXAMPLE_README = `# Hi, I'm ${user}

I build tools for developers. Here is what I have been up to.

<p align="center">
  <img height="165" src="https://github-readme-stats.vercel.app/api?username=${user}&show_icons=true&theme=tokyonight&hide_border=true" alt="GitHub stats" />
  <img height="165" src="https://github-readme-stats.vercel.app/api/top-langs/?username=${user}&layout=compact&theme=tokyonight&hide_border=true&langs_count=6" alt="Top languages" />
</p>

[![GitHub streak](https://streak-stats.demolab.com?user=${user}&theme=tokyonight&hide_border=true)](https://git.io/streak-stats)

## Trophies

[![Trophies](https://github-profile-trophy.vercel.app/?username=${user}&theme=onedark&no-frame=true&column=7)](https://github.com/ryo-ma/github-profile-trophy)

## Activity

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github-readme-activity-graph.vercel.app/graph?username=${user}&theme=github-compact&hide_border=true" />
  <img alt="Contribution graph" src="https://github-readme-activity-graph.vercel.app/graph?username=${user}&theme=minimal" />
</picture>

## Projects

[![Readme card](https://github-readme-stats.vercel.app/api/pin/?username=vercel&repo=next.js&theme=tokyonight)](https://github.com/vercel/next.js)

![Coding time](https://github-readme-stats.vercel.app/api/wakatime?username=${user}&layout=compact)
`;
