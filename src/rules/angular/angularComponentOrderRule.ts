import * as ts from 'typescript';
import * as Lint from 'tslint';
import { hasModifier, isConstructorDeclaration, isMethodDeclaration, isPropertyDeclaration,
    isGetAccessorDeclaration, isIdentifier, isSyntaxList } from 'tsutils';

const angularLifecycleMethods = [
    'ngOnChanges',
    'ngOnInit',
    'ngDoCheck',
    'ngAfterContentInit',
    'ngAfterContentChecked',
    'ngAfterViewInit',
    'ngAfterViewChecked',
    'ngOnDestroy'
];

const defaultOrder = [
    'static-property',
    'static-method',

    'component-input',
    'component-output',

    'component-hostbinding-attr',
    'component-hostbinding-class',
    'component-hostbinding-style',
    'component-hostbinding-other',

    'component-contentchild',
    'component-contentchildren',
    'component-viewchild',
    'component-viewchildren',

    'instance-property',
    'instance-constructor',

    ...angularLifecycleMethods.map(item => 'lifecycle-' + item.substr(2).toLowerCase()),

    'component-listener-global',
    'component-listener-host',
    'component-listener-view',

    'instance-method',
];

function getDecorator(node: ts.Node, decoratorName: string) {
    return Array.from(node.decorators || []).find(item => {
        const currentDecoratorName = item.expression.getFirstToken()
            ? item.expression.getFirstToken().getText()
            : item.expression.getText();

        return decoratorName === currentDecoratorName;
    });
}

function isStatic(node: ts.Node) {
    return hasModifier(node.modifiers, ts.SyntaxKind.StaticKeyword);
}

function getHostBindingType(node: ts.Decorator) {
    const binding = node.expression.getChildAt(2).getFirstToken().getText();
    const matchedBinding = ['class', 'attr', 'style'].find(item => binding.startsWith(`\'${item}.`));
    return `component-hostbinding-${matchedBinding || 'other'}`;
}

function getNodeType(node: ts.Node) {
    if (getDecorator(node, 'Input')) {
        return 'component-input';
    }

    if (getDecorator(node, 'Output')) {
        return 'component-output';
    }

    if (isConstructorDeclaration(node)) {
        return 'instance-constructor';
    }

    if (isGetAccessorDeclaration(node)) {
        const hostBindingDecorator = getDecorator(node, 'HostBinding');
        if (hostBindingDecorator) {
            return getHostBindingType(hostBindingDecorator);
        }
    }

    if (isPropertyDeclaration(node)) {
        const hostBindingDecorator = getDecorator(node, 'HostBinding');
        if (hostBindingDecorator) {
            return getHostBindingType(hostBindingDecorator);
        }

        if (getDecorator(node, 'ContentChild')) {
            return 'component-contentchild';
        }

        if (getDecorator(node, 'ContentChildren')) {
            return 'component-contentchildren';
        }

        if (getDecorator(node, 'ViewChild')) {
            return 'component-viewchild';
        }

        if (getDecorator(node, 'ViewChildren')) {
            return 'component-viewchildren';
        }

        return isStatic(node) ? 'static-property' : 'instance-property';
    }

    if (isMethodDeclaration(node)) {
        const methodName = node.getChildren().find(isIdentifier).getText();

        if (angularLifecycleMethods.indexOf(methodName) > -1) {
            return 'lifecycle-' + methodName.substr(2).toLowerCase();
        }

        const hostListenerDecorator = getDecorator(node, 'HostListener');

        if (hostListenerDecorator) {
            const binding = hostListenerDecorator.expression.getChildAt(2).getFirstToken().getText();
            if (binding.indexOf(':') > -1) {
                return 'component-listener-global';
            }

            return 'component-listener-host';
        }

        if (methodName.startsWith('on')
            && methodName.substr(2,1).toUpperCase() === methodName.substr(2,1)) {
            return 'component-listener-view';
        }


        return isStatic(node) ? 'static-method' : 'instance-method';
    }

    return 'unknow';
}

export class Rule extends Lint.Rules.AbstractRule {
    public static metadata: Lint.IRuleMetadata = {
        ruleName: "member-ordering",
        description: "Enforces member ordering.",
        hasFix: false,
        rationale: Lint.Utils.dedent`
            TODO
        `,
        optionsDescription: '',
        options: {
            type: "object",
            properties: {
                order: {
                    type: "array",
                    items: {
                        type: "string",
                        enum: defaultOrder,
                    },
                    maxLength: defaultOrder.length,
                },
            },
            additionalProperties: false,
        },
        optionExamples: [],
        type: "typescript",
        typescriptOnly: true,
    };

    public static FAILURE_STRING = 'angular component order';

    public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
        const [ args = {} ] = this.ruleArguments;

        if (args.order) {
            for (const item of args.order) {
                if (!defaultOrder.includes(item)) {
                    throw new Error(`"${item}" is not a valid order option`);
                }
            }
        }

        return this.applyWithWalker(new AngularComponentOrderWalker(sourceFile, this.getOptions()));
    }
}

class AngularComponentOrderWalker extends Lint.RuleWalker {

    public visitClassDeclaration(node: ts.ClassDeclaration): void {

        const [ args = {} ] = this.getOptions();
        const correctOrder = args.order || defaultOrder;

        const openBraceChildIndex = node.getChildren().findIndex(item => ts.SyntaxKind.OpenBraceToken === item.kind);
        const classContent = node.getChildren().slice(openBraceChildIndex).find(isSyntaxList);

        const allNodesWithType = classContent.getChildren().map(node => ({ node, type: getNodeType(node) }));

        const nodesInWrongPosition = allNodesWithType.filter((item, index, all) => index > 0
                && correctOrder.indexOf(item.type) > -1
                && correctOrder.indexOf(item.type) < correctOrder.indexOf(all[index - 1].type)
        );

        nodesInWrongPosition.forEach(item => {
            const node = (item.node as ts.NamedDeclaration).name || item.node.getFirstToken();
            this.addFailureAtNode(node, Rule.FAILURE_STRING)
        });

        super.visitClassDeclaration(node);
    }
}