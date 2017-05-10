"use strict";

const _                      = require('lodash');

const extract                = require('./extract');
const dependencyEndsUpAtFrom = require('./dependencyEndsUpAtFrom');
const gather                 = require('./gatherInitialSources');
const summarize              = require('./summarize');
const addValidations         = require('./addValidations');

function extractRecursive (pFileName, pOptions, pVisited) {
    pOptions = pOptions || {};
    pVisited.add(pFileName);

    const lDependencies = extract(pFileName, pOptions);

    return lDependencies
        .filter(pDep => pDep.followable)
        .reduce(
            (pAll, pDep) => {
                if (!pVisited.has(pDep.resolved)){
                    return pAll.concat(
                        extractRecursive(pDep.resolved, pOptions, pVisited)
                    );
                }
                return pAll;
            }, [{
                source: pFileName,
                dependencies: lDependencies
            }]
        );
}

function extractFileDirArray(pFileDirArray, pOptions) {
    let lVisited = new Set();

    return _.spread(_.concat)(
        gather(pFileDirArray, pOptions)
            .reduce((pDependencies, pFilename) => {
                if (!lVisited.has(pFilename)){
                    lVisited.add(pFilename);
                    return pDependencies.concat(
                        extractRecursive(pFilename, pOptions, lVisited)
                    );
                }
                return pDependencies;
            }, [])
    );
}

function isNotFollowable(pToDependency) {
    return !(pToDependency.followable);
}

function notInFromListAlready(pFromList) {
    return pToListItem =>
        !pFromList.some(pFromListItem => pFromListItem.source === pToListItem.resolved);
}

function toDependencyToSource(pToListItem) {
    return {
        source          : pToListItem.resolved,
        followable      : pToListItem.followable,
        coreModule      : pToListItem.coreModule,
        couldNotResolve : pToListItem.couldNotResolve,
        dependencyTypes : pToListItem.dependencyTypes,
        dependencies    : []
    };
}

function complete(pAll, pFromListItem) {
    return pAll
        .concat(pFromListItem)
        .concat(
            pFromListItem.dependencies
                .filter(isNotFollowable)
                .filter(notInFromListAlready(pAll))
                .map(toDependencyToSource)
        );
}

function makeOptionsPresentable(pOptions) {
    const SHARABLE_OPTIONS = [
        "rulesFile",
        "outputTo",
        "exclude",
        "system",
        "outputType",
        "prefix"
    ];

    if (!Boolean(pOptions)){
        return {};
    }
    return SHARABLE_OPTIONS
        .filter(pOption => pOptions.hasOwnProperty(pOption))
        .reduce(
            (pAll, pOption) => {
                pAll[pOption] = pOptions[pOption];
                return pAll;
            },
            {}
        );
}

function circularityDetectionNecessary(pOptions) {
    if (pOptions) {
        if (pOptions.forceCircular) {
            return true;
        }
        if (pOptions.validate && pOptions.ruleSet) {
            return pOptions.ruleSet.forbidden &&
                pOptions.ruleSet.forbidden.some(
                    pRule => pRule.to.hasOwnProperty("circular")
                );
        }
    }
    return false;
}

function addCircularityCheckToDependency (pToDep, pGraph, pFrom) {
    return Object.assign(
        {},
        pToDep,
        {
            circular: dependencyEndsUpAtFrom(pGraph, pFrom, pToDep.resolved)
        }
    );
}

/**
 * Runs through all dependencies, for each of them determines
 * whether it's (part of a) circular (relationship) and returns the
 * dependencies with that added.
 *
 * @param  {Object} pDependencies [description]
 * @return {Object}               the same dependencies, but for each
 *                                of them added whether or not it is
 *                                part of
 */
function addCircularityCheckToGraph (pDependencies) {
    return pDependencies.map(
        pNode => Object.assign(
            {},
            pNode,
            {
                dependencies: pNode.dependencies.map(
                    pToDep => addCircularityCheckToDependency(pToDep, pDependencies, pNode.source)
                )
            }
        )
    );
}

module.exports = (pFileDirArray, pOptions, pCallback) => {
    const lCallback = pCallback ? pCallback : (pInput => pInput);

    let lDependencies = _(
        extractFileDirArray(pFileDirArray, pOptions).reduce(complete, [])
    ).uniqBy(pDependency => pDependency.source)
     .value();

    if (circularityDetectionNecessary(pOptions)){
        lDependencies = addCircularityCheckToGraph(lDependencies);
    }

    lDependencies = addValidations(
        lDependencies,
        pOptions ? pOptions.validate : false,
        pOptions ? pOptions.ruleSet : {}
     );

    return lCallback(
        {
            dependencies : lDependencies,
            summary      :
                Object.assign(
                    summarize(lDependencies),
                    {
                        optionsUsed: makeOptionsPresentable(pOptions)
                    }
                )
        }
    );
};

/* eslint security/detect-object-injection: 0 */
