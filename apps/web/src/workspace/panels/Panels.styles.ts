import { mergeCssModules } from '../../merge-css-modules';
import part1 from './Panels.module.css';
import part2 from './Panels.part-2.module.css';
import part3 from './Panels.part-3.module.css';

export default mergeCssModules(part1, part2, part3);
