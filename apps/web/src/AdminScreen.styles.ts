import { mergeCssModules } from './merge-css-modules';
import part1 from './AdminScreen.module.css';
import part2 from './AdminScreen.part-2.module.css';

export default mergeCssModules(part1, part2);
