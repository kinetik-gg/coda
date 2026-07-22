import { mergeCssModules } from './merge-css-modules';
import part1 from './ProjectManagementScreen.module.css';
import part2 from './ProjectManagementScreen.part-2.module.css';
import part3 from './ProjectManagementScreen.part-3.module.css';

export default mergeCssModules(part1, part2, part3);
