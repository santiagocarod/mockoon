import { expect } from 'chai';
import { Tests } from 'test/lib/tests';

describe('UI interactions', () => {
  describe('Environments menu', () => {
    const tests = new Tests('ui');

    it('Collapsed environment menu item displays first two characters of name', async () => {
      await tests.helpers.assertHasActiveEnvironment(' FT');
    });

    it('Collapsed environment menu item displays all icons', async () => {
      await tests.helpers.assertEnvironmentServerIconsExists(1, 'cors');
      await tests.helpers.assertEnvironmentServerIconsExists(1, 'https');
      await tests.helpers.assertEnvironmentServerIconsExists(1, 'proxy-mode');
    });

    it('Collapsed environment menu item has a context menu', async () => {
      await tests.helpers.contextMenuOpen(
        '.environments-menu .nav-item .nav-link.active'
      );
      await tests.helpers.waitElementExist('.context-menu');
    });

    it('Opened environment menu item displays full name', async () => {
      await tests.helpers.toggleEnvironmentMenu();
      await tests.helpers.assertHasActiveEnvironment('FT env');
    });

    it('Opened environment menu has button to add an environment', async () => {
      await tests.helpers.waitElementExist(
        '.environments-menu .nav:first-of-type .nav-item .nav-link.add-environment'
      );
    });

    it('Opened environment menu item displays all icons', async () => {
      await tests.helpers.assertEnvironmentServerIconsExists(1, 'cors');
      await tests.helpers.assertEnvironmentServerIconsExists(1, 'https');
      await tests.helpers.assertEnvironmentServerIconsExists(1, 'proxy-mode');
    });

    it('Opened environment menu item has a context menu', async () => {
      await tests.helpers.contextMenuOpen(
        '.environments-menu .nav-item .nav-link.active'
      );
      await tests.helpers.waitElementExist('.context-menu');
    });
  });

  describe('Inputs autofocus', () => {
    const tests = new Tests('ui');

    it('Focus "documentation" input, add route, and assert "path" input has focus', async () => {
      const documentationSelector = 'input[formcontrolname="documentation"]';

      await tests.helpers.setElementValue(documentationSelector, 'test');
      const documentationInput = await tests.helpers.getElement(
        documentationSelector
      );
      expect(await documentationInput.isFocused()).to.equal(true);

      await tests.helpers.addRoute();

      const pathInput = await tests.helpers.getElement(
        'input[formcontrolname="endpoint"]'
      );
      expect(await pathInput.isFocused()).to.equal(true);
    });
  });

  describe('Add CORS headers', () => {
    const tests = new Tests('ui');

    const environmentHeadersSelector =
      'app-headers-list#environment-headers .headers-list';

    it('Switch to environment settings and check headers count', async () => {
      await tests.helpers.switchViewInHeader('ENV_SETTINGS');

      await tests.helpers.countElements(environmentHeadersSelector, 1);
    });

    describe('Check environment headers', () => {
      ['Content-Type', 'application/xml'].forEach((expected, index) => {
        it(`Row 1 input ${
          index + 1
        } should be equal to ${expected}`, async () => {
          const value = await tests.helpers.getElementAttribute(
            `${environmentHeadersSelector}:nth-of-type(1) input:nth-of-type(${
              index + 1
            })`,
            'value'
          );
          expect(value).to.equal(expected);
        });
      });
    });

    it('Click on "Add CORS headers" button and check headers count', async () => {
      await tests.helpers.elementClick('button.settings-add-cors');

      await tests.helpers.countElements(environmentHeadersSelector, 4);
    });

    describe('Check environment headers', () => {
      [
        'Content-Type',
        'application/xml',
        'Access-Control-Allow-Origin',
        '*',
        'Access-Control-Allow-Methods',
        'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
        'Access-Control-Allow-Headers',
        'Content-Type, Origin, Accept, Authorization, Content-Length, X-Requested-With'
      ].forEach((expected, index) => {
        it(`Row ${Math.ceil((index + 1) / 2)} input ${
          index + 1
        } should be equal to ${expected}`, async () => {
          const value = await tests.helpers.getElementAttribute(
            `${environmentHeadersSelector}:nth-of-type(${Math.ceil(
              (index + 1) / 2
            )}) input:nth-of-type(${(index + 1) % 2 === 0 ? 2 : 1})`,
            'value'
          );
          expect(value).to.equal(expected);
        });
      });
    });
  });

  describe('Headers && Rules tabs', () => {
    const tests = new Tests('ui');

    it('Headers tab shows the header count', async () => {
      const headersTabSelector =
        '#route-responses-menu .nav.nav-tabs .nav-item:nth-child(2)';

      let text = await tests.helpers.getElementText(headersTabSelector);
      expect(text).to.equal('Headers (1)');

      await tests.helpers.switchTab('HEADERS');
      await tests.helpers.addHeader('route-response-headers', {
        key: 'route-header',
        value: 'route-header'
      });

      // this is needed for the tab re-render to complete
      await tests.app.client.pause(100);
      text = await tests.helpers.getElementText(headersTabSelector);
      expect(text).to.equal('Headers (2)');

      await tests.helpers.addHeader('route-response-headers', {
        key: 'route-header-2',
        value: 'route-header-2'
      });

      // this is needed for the tab re-render to complete
      await tests.app.client.pause(100);
      text = await tests.helpers.getElementText(headersTabSelector);
      expect(text).to.equal('Headers (3)');

      await tests.helpers.addRouteResponse();
      await tests.helpers.countRouteResponses(2);

      // this is needed for the tab re-render to complete
      await tests.app.client.pause(100);
      text = await tests.helpers.getElementText(headersTabSelector);
      expect(text).to.equal('Headers');

      await tests.helpers.switchTab('HEADERS');
      await tests.helpers.addHeader('route-response-headers', {
        key: 'route-header-3',
        value: 'route-header-3'
      });

      // this is needed for the tab re-render to complete
      await tests.app.client.pause(100);
      text = await tests.helpers.getElementText(headersTabSelector);
      expect(text).to.equal('Headers (1)');
    });

    it('Rules tab shows the rule count', async () => {
      const rulesTabSelector =
        '#route-responses-menu .nav.nav-tabs .nav-item:nth-child(3)';

      let text = await tests.helpers.getElementText(rulesTabSelector);
      expect(text).to.equal('Rules');

      await tests.helpers.switchTab('RULES');
      await tests.helpers.addResponseRule({
        modifier: 'var',
        target: 'params',
        value: '10',
        isRegex: false
      });

      // this is needed for the tab re-render to complete
      await tests.app.client.pause(100);
      text = await tests.helpers.getElementText(rulesTabSelector);
      expect(text).to.equal('Rules (1)');

      await tests.helpers.addResponseRule({
        modifier: 'test',
        target: 'query',
        value: 'true',
        isRegex: false
      });

      // this is needed for the tab re-render to complete
      await tests.app.client.pause(100);
      text = await tests.helpers.getElementText(rulesTabSelector);
      expect(text).to.equal('Rules (2)');

      await tests.helpers.addRouteResponse();
      await tests.helpers.countRouteResponses(3);

      // this is needed for the tab re-render to complete
      await tests.app.client.pause(100);
      text = await tests.helpers.getElementText(rulesTabSelector);
      expect(text).to.equal('Rules');

      await tests.helpers.switchTab('RULES');
      await tests.helpers.addResponseRule({
        modifier: 'var',
        target: 'params',
        value: '10',
        isRegex: false
      });

      // this is needed for the tab re-render to complete
      await tests.app.client.pause(100);
      text = await tests.helpers.getElementText(rulesTabSelector);
      expect(text).to.equal('Rules (1)');
    });
  });

  describe('Input number mask', () => {
    const tests = new Tests('ui');
    const portSelector = 'input[formcontrolname="port"]';

    it('should allow numbers', async () => {
      await tests.helpers.setElementValue(portSelector, '1234');
      await tests.helpers.assertElementValue(portSelector, '1234');
    });

    it('should prevent entering letters and other characters', async () => {
      await tests.helpers.addElementValue(portSelector, 'a.e-+');
      await tests.helpers.assertElementValue(portSelector, '1234');
    });

    it('should enforce max constraint', async () => {
      await tests.helpers.setElementValue(portSelector, '1000000');
      await tests.helpers.assertElementValue(portSelector, '65535');
    });
  });

  describe('Valid path mask', () => {
    const tests = new Tests('ui');
    const prefixSelector = 'input[formcontrolname="endpointPrefix"]';

    it('should remove leading slash', async () => {
      await tests.helpers.setElementValue(prefixSelector, '/prefix');
      await tests.helpers.assertElementValue(prefixSelector, 'prefix');
    });

    it('should deduplicate slashes', async () => {
      await tests.helpers.setElementValue(prefixSelector, 'prefix//path');
      await tests.helpers.assertElementValue(prefixSelector, 'prefix/path');
    });
  });

  describe('Headers typeahead', () => {
    const tests = new Tests('ui');
    const typeaheadEntrySelector = 'ngb-typeahead-window button:first-of-type';

    const testCases = [
      {
        description: 'should use the typeahead in the route headers',
        headers: 'route-response-headers',
        preHook: async () => {
          await tests.helpers.switchTab('HEADERS');
        }
      },
      {
        description: 'should use the typeahead in the environment headers',
        headers: 'environment-headers',
        preHook: async () => {
          await tests.helpers.switchViewInHeader('ENV_SETTINGS');
        }
      },
      {
        description: 'should use the typeahead in the proxy request headers',
        headers: 'proxy-req-headers',
        preHook: async () => {
          await tests.helpers.switchViewInHeader('ENV_SETTINGS');
        }
      },
      {
        description: 'should use the typeahead in the proxy response headers',
        headers: 'proxy-res-headers',
        preHook: async () => {
          await tests.helpers.switchViewInHeader('ENV_SETTINGS');
        }
      }
    ];

    testCases.forEach((testCase) => {
      const headersSelector = `app-headers-list#${testCase.headers}`;
      const firstHeaderSelector = `${headersSelector} .headers-list:last-of-type input:nth-of-type(1)`;

      it(testCase.description, async () => {
        await testCase.preHook();
        await tests.helpers.elementClick(`${headersSelector} button`);
        await tests.helpers.setElementValue(firstHeaderSelector, 'typ');
        await tests.helpers.waitElementExist(typeaheadEntrySelector);
        await tests.helpers.elementClick(typeaheadEntrySelector);
        const headerName = await tests.helpers.getElementValue(
          firstHeaderSelector
        );
        expect(headerName).to.equal('Content-Type');
      });
    });
  });
});
