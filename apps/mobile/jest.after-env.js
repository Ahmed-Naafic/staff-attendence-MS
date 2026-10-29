// Screen tests render the whole app; allow time for its start-up on a slow machine.
import { configure } from '@testing-library/react-native';

configure({ asyncUtilTimeout: 5000 });
