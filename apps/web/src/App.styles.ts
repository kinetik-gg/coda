import { mergeCssModules } from './merge-css-modules';
import part1 from './App.module.css';
import part2 from './App.part-2.module.css';

export default mergeCssModules(part1, part2);
