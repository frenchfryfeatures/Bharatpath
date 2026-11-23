const { withAndroidStyles, AndroidConfig } = require('expo/config-plugins');

// The app paints an opaque safe-area strip. An additional OS contrast scrim
// would tint that white surface in three-button mode, so it is unnecessary.
module.exports = config => withAndroidStyles(config, mod => {
  mod.modResults = AndroidConfig.Styles.assignStylesValue(mod.modResults, {
    add: true,
    parent: AndroidConfig.Styles.getAppThemeGroup(),
    name: 'android:enforceNavigationBarContrast',
    value: 'false',
  });
  return mod;
});
