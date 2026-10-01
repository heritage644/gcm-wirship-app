import { registerRootComponent } from 'expo';

import App from './src/App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and makes sure the environment is set up correctly whether the app is loaded
// in Expo Go or in a native build.
registerRootComponent(App);
